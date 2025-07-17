require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const https = require('https');
const cheerio = require('cheerio');

// Временное решение для SSL проблем с GigaChat (только для разработки)
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// GigaChat API конфигурация
const GIGA_CHAT_API = 'https://gigachat.devices.sberbank.ru/api/v1';
const GIGA_CHAT_TOKEN = process.env.GIGA_CHAT_TOKEN;

// Функция для получения токена доступа
async function getAccessToken() {
  try {
    const response = await axios.post('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', 
      'scope=GIGACHAT_API_PERS',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Authorization': `Basic ${GIGA_CHAT_TOKEN}`,
          'RqUID': generateUUID()
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('Ошибка получения токена:', error.response?.data || error.message);
    throw error;
  }
}

// Функция для генерации UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Функция для поиска в интернете
async function searchInternet(query) {
  try {
    console.log(`Выполняем поиск: ${query}`);
    
    // Используем DuckDuckGo API через axios
    const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const data = response.data;
    let results = [];
    
    // Получаем результаты из разных источников
    if (data.AbstractText) {
      results.push(`Краткая информация: ${data.AbstractText}`);
    }
    
    if (data.Answer) {
      results.push(`Ответ: ${data.Answer}`);
    }
    
    if (data.Definition) {
      results.push(`Определение: ${data.Definition}`);
    }
    
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      results.push('Связанные темы:');
      data.RelatedTopics.slice(0, 3).forEach(topic => {
        if (topic.Text) {
          results.push(`- ${topic.Text}`);
        }
      });
    }
    
    // Также добавляем информацию из Infobox если есть
    if (data.Infobox && data.Infobox.content && data.Infobox.content.length > 0) {
      results.push('Дополнительная информация:');
      data.Infobox.content.slice(0, 3).forEach(item => {
        if (item.label && item.value) {
          results.push(`- ${item.label}: ${item.value}`);
        }
      });
    }
    
    if (results.length === 0) {
      // Если ничего не найдено через DuckDuckGo, даем общий ответ
      results.push(`Поиск по запросу "${query}" не дал конкретных результатов из DuckDuckGo API. Это может означать, что требуется более специфичный запрос или поиск в других источниках.`);
    }
    
    return results.join('\n');
  } catch (error) {
    console.error('Ошибка поиска в интернете:', error.message);
    return `Ошибка при поиске в интернете: ${error.message}. Попробуйте переформулировать запрос.`;
  }
}

// Функция для получения содержимого веб-страницы
async function fetchWebPageContent(url) {
  try {
    // Если URL не содержит протокола, добавляем https://
    if (!url.match(/^https?:\/\//)) {
      url = 'https://' + url;
    }
    
    // Проверяем, что URL является валидным
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Неподдерживаемый протокол');
    }

    console.log(`Получаем содержимое страницы: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 15000, // 15 секунд
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });
    
    console.log(`Статус ответа: ${response.status}`);
    console.log(`Размер контента: ${response.data.length} символов`);

    // Парсим HTML с помощью cheerio
    const $ = cheerio.load(response.data);
    
    // Удаляем ненужные элементы
    $('script, style, nav, footer, header, aside, .ad, .advertisement, .cookie-banner').remove();
    
    // Получаем заголовок страницы
    const title = $('title').text().trim();
    
    // Получаем основной контент
    let content = '';
    
    // Пытаемся найти основной контент в типичных контейнерах
    const mainSelectors = [
      'article', 
      'main', 
      '.content', 
      '.main-content', 
      '.post-content', 
      '.article-content',
      '.entry-content',
      '#content',
      '#main'
    ];
    
    let mainContent = null;
    for (const selector of mainSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        mainContent = element.first();
        break;
      }
    }
    
    // Если не нашли основной контент, используем body
    if (!mainContent) {
      mainContent = $('body');
    }
    
    // Извлекаем текст из параграфов и заголовков
    const textElements = mainContent.find('p, h1, h2, h3, h4, h5, h6, li, div, span').toArray();
    const textContent = textElements.map(el => {
      const text = $(el).text().trim();
      return text.length > 20 ? text : null; // Игнорируем слишком короткие элементы
    }).filter(text => text && text.length > 0);
    
    content = textContent.join('\n\n');
    
    // Если контент всё ещё пустой, попробуем извлечь любой видимый текст
    if (!content || content.length < 50) {
      console.log('Основной контент не найден, извлекаем любой видимый текст...');
      const allText = $('body').text().trim();
      if (allText.length > 0) {
        content = allText;
      }
    }
    
    console.log(`Извлечено символов контента: ${content.length}`);
    
    // Ограничиваем длину контента
    if (content.length > 5000) {
      content = content.substring(0, 5000) + '...';
    }
    
    const result = {
      title: title || 'Без заголовка',
      url: url,
      content: content || 'Контент не найден',
      summary: `Заголовок: ${title || 'Без заголовка'}\nURL: ${url}\n\nСодержимое:\n${content || 'Контент не найден или страница пустая'}`
    };
    
    console.log(`Результат анализа страницы: заголовок="${title}", контент=${content.length} символов`);
    
    return result.summary;
    
  } catch (error) {
    console.error('Ошибка при получении веб-страницы:', error.message);
    return `Ошибка при получении содержимого страницы ${url}: ${error.message}`;
  }
}

// Функции для GigaChat (правильный формат)
const functions = [
  {
    name: 'search_internet',
    description: 'Поиск актуальной информации в интернете через DuckDuckGo. Используй когда пользователь спрашивает о новостях, последних событиях, актуальной информации или просит что-то найти в интернете.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос для поиска в интернете'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'fetch_web_page',
    description: 'Получение и анализ содержимого веб-страницы по URL. Используй когда пользователь предоставляет URL веб-страницы. Извлекает заголовок, основной текст и структуру страницы для последующего анализа.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL веб-страницы для анализа (должен начинаться с http:// или https://)'
        }
      },
      required: ['url']
    }
  }
];

// Обработка сообщений от GigaChat
async function sendToGigaChat(message, conversationHistory = []) {
  try {
    const accessToken = await getAccessToken();
    
    // Системный prompt для принуждения использования инструментов
    const systemPrompt = `Ты GigaChat Assistant с доступом к инструментам интернета. 

ВАЖНЫЕ ПРАВИЛА:
1. Когда пользователь предоставляет URL (с протоколом или без, например: https://example.com или example.com), ты ОБЯЗАН использовать инструмент fetch_web_page для анализа страницы.
2. Когда пользователь просит прочитать, открыть, проанализировать веб-страницу или сайт, ты ОБЯЗАН использовать инструмент fetch_web_page.
3. Когда пользователь просит найти актуальную информацию, новости или что-то из интернета, ты ОБЯЗАН использовать инструмент search_internet.
4. НЕ отвечай на основе своих внутренних знаний, если требуется использование инструмента.
5. Всегда используй соответствующий инструмент для получения актуальной информации.

Примеры когда использовать инструменты:
- "Прочитай эту страницу: https://example.com" → используй fetch_web_page
- "Прочитай страницу example.com" → используй fetch_web_page
- "Что на этом сайте: news.com" → используй fetch_web_page
- "Открой shuvaev.com" → используй fetch_web_page
- "Найди последние новости о..." → используй search_internet
- "Поищи информацию о..." → используй search_internet

ВАЖНО: Результаты функций приходят в формате JSON объекта {"result": "содержимое"}. Извлекай информацию из поля "result" и анализируй её.

После получения результатов от инструмента, проанализируй их и дай пользователю краткий, но информативный ответ.`;

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...conversationHistory,
      {
        role: 'user',
        content: message
      }
    ];
    
    // Определяем, нужно ли принудительно использовать инструменты
    const containsUrl = message.match(/(https?:\/\/[^\s]+)/);
    // Ищем домены без протокола (например, shuvaev.com, example.org)
    const containsDomain = message.match(/\b[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,})\b/);
    
    const webPageKeywords = [
      'прочитай', 'открой', 'анализ', 'содержимое', 'контент', 'страниц', 'сайт',
      'что на', 'посмотри', 'изучи', 'проверь'
    ];
    const searchKeywords = [
      'найди', 'поищи', 'search', 'найти', 'поиск', 'информация о', 'новости', 
      'последние', 'актуальн', 'что нового', 'свежие', 'сейчас', 'сегодня'
    ];
    
    const needsWebPage = webPageKeywords.some(keyword => message.toLowerCase().includes(keyword));
    const needsSearch = searchKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    let functionCall = 'auto';
    if (containsUrl || (containsDomain && needsWebPage)) {
      // Принудительно вызываем fetch_web_page для URL или доменов с ключевыми словами
      functionCall = { name: 'fetch_web_page' };
      const target = containsUrl ? containsUrl[0] : containsDomain[0];
      console.log(`Принудительное использование fetch_web_page для: ${target}`);
    } else if (needsSearch) {
      // Принудительно вызываем search_internet для поиска
      functionCall = { name: 'search_internet' };
      console.log(`Принудительное использование search_internet для поиска`);
    }
    
    console.log(`Отправляем запрос в GigaChat с function_call:`, functionCall);
    
    const response = await axios.post(`${GIGA_CHAT_API}/chat/completions`, {
      model: 'GigaChat-Max',
      messages: messages,
      functions: functions,
      function_call: functionCall,
      temperature: 0.7,
      max_tokens: 1000
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });
    
    console.log(`Получен ответ от GigaChat:`, JSON.stringify(response.data, null, 2));
    
    const assistantMessage = response.data.choices[0].message;
    
    // Проверяем, есть ли вызов функции (GigaChat Max формат)
    if (assistantMessage.function_call) {
      const functionCall = assistantMessage.function_call;
      let functionResult = '';
      let toolInfo = {};
      
      console.log(`GigaChat вызвал функцию: ${functionCall.name}`);
      console.log(`Аргументы функции:`, functionCall.arguments);
      
      try {
        if (functionCall.name === 'search_internet') {
          // Аргументы могут быть объектом или JSON строкой
          let args;
          if (typeof functionCall.arguments === 'string') {
            try {
              args = JSON.parse(functionCall.arguments);
            } catch (parseError) {
              console.error('Ошибка парсинга аргументов JSON:', parseError);
              // Если не удается распарсить JSON, используем строку как есть
              args = { query: functionCall.arguments };
            }
          } else {
            args = functionCall.arguments;
          }
          
          const searchQuery = args.query || message; // Fallback to original message
          console.log(`Выполняем поиск с запросом: ${searchQuery}`);
          
          functionResult = await searchInternet(searchQuery);
          toolInfo = {
            searchPerformed: true,
            searchQuery: searchQuery,
            toolUsed: 'search_internet'
          };
        } else if (functionCall.name === 'fetch_web_page') {
          // Аргументы могут быть объектом или JSON строкой
          let args;
          if (typeof functionCall.arguments === 'string') {
            try {
              args = JSON.parse(functionCall.arguments);
            } catch (parseError) {
              console.error('Ошибка парсинга аргументов JSON:', parseError);
              // Пытаемся извлечь URL из исходного сообщения
              const urlMatch = message.match(/(https?:\/\/[^\s]+)/);
              args = { url: urlMatch ? urlMatch[0] : functionCall.arguments };
            }
          } else {
            args = functionCall.arguments;
          }
          
          let url = args.url || (message.match(/(https?:\/\/[^\s]+)/) || [])[0];
          // Если URL не найден, ищем домен без протокола
          if (!url) {
            const domainMatch = message.match(/\b[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,})\b/);
            url = domainMatch ? domainMatch[0] : null;
          }
          
          if (!url) {
            functionResult = 'Ошибка: URL не найден в аргументах функции';
          } else {
            console.log(`Анализируем страницу: ${url}`);
            functionResult = await fetchWebPageContent(url);
          }
          
          toolInfo = {
            searchPerformed: true,
            searchQuery: url,
            toolUsed: 'fetch_web_page'
          };
        }
      } catch (error) {
        console.error('Ошибка при выполнении функции:', error);
        functionResult = `Ошибка при выполнении функции ${functionCall.name}: ${error.message}`;
        toolInfo = {
          searchPerformed: false,
          error: error.message,
          toolUsed: functionCall.name
        };
      }
      
      // Отправляем результаты функции обратно в GigaChat
      // GigaChat ожидает результат функции в формате JSON
      const functionResponseMessages = [
        ...messages,
        assistantMessage,
        {
          role: 'function',
          name: functionCall.name,
          content: JSON.stringify({ result: functionResult })
        }
      ];
      
      const finalResponse = await axios.post(`${GIGA_CHAT_API}/chat/completions`, {
        model: 'GigaChat-Max',
        messages: functionResponseMessages,
        temperature: 0.7,
        max_tokens: 1000
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      });
      
      return {
        response: finalResponse.data.choices[0].message.content,
        ...toolInfo
      };
    }
    
    // Fallback: если GigaChat не использовал функции, но они были нужны
    if ((containsUrl || (containsDomain && needsWebPage) || needsSearch) && !assistantMessage.function_call) {
      console.log('GigaChat не использовал функции, принудительно вызываем...');
      
      let functionResult = '';
      let toolInfo = {};
      
      try {
        if (containsUrl || (containsDomain && needsWebPage)) {
          const target = containsUrl ? containsUrl[0] : containsDomain[0];
          console.log(`Принудительно анализируем: ${target}`);
          functionResult = await fetchWebPageContent(target);
          toolInfo = {
            searchPerformed: true,
            searchQuery: target,
            toolUsed: 'fetch_web_page',
            fallback: true
          };
        } else if (needsSearch) {
          console.log(`Принудительно ищем: ${message}`);
          functionResult = await searchInternet(message);
          toolInfo = {
            searchPerformed: true,
            searchQuery: message,
            toolUsed: 'search_internet',
            fallback: true
          };
        }
      } catch (error) {
        console.error('Ошибка в fallback механизме:', error);
        functionResult = `Ошибка при выполнении поиска: ${error.message}`;
        toolInfo = {
          searchPerformed: false,
          error: error.message,
          fallback: true
        };
      }
      
      // Отправляем результат обратно в GigaChat для анализа
      const fallbackMessages = [
        ...messages,
        {
          role: 'user',
          content: `Вот результаты поиска/анализа: ${functionResult}. Пожалуйста, проанализируй эту информацию и дай краткий ответ пользователю.`
        }
      ];
      
      const fallbackResponse = await axios.post(`${GIGA_CHAT_API}/chat/completions`, {
        model: 'GigaChat-Max',
        messages: fallbackMessages,
        temperature: 0.7,
        max_tokens: 1000
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      });
      
      return {
        response: fallbackResponse.data.choices[0].message.content,
        ...toolInfo
      };
    }
    
    return {
      response: assistantMessage.content,
      searchPerformed: false
    };
    
  } catch (error) {
    console.error('Ошибка при отправке в GigaChat:', error.message);
    if (error.response) {
      console.error('Ответ API:', error.response.data);
    }
    throw error;
  }
}

// API endpoints
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    const result = await sendToGigaChat(message, history);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при общении с GigaChat' });
  }
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте браузер и перейдите по адресу: http://localhost:${PORT}`);
  console.log(`Токен GigaChat: ${GIGA_CHAT_TOKEN ? 'Загружен (' + GIGA_CHAT_TOKEN.substring(0, 20) + '...)' : 'Не найден'}`);
}); 