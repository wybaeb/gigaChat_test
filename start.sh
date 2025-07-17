#!/bin/bash

echo "🚀 Запуск GigaChat Web Assistant..."

# Проверяем, существует ли .env файл
if [ ! -f .env ]; then
    echo "⚠️  Файл .env не найден!"
    echo "Создайте файл .env на основе .env.example и добавьте ваш токен GigaChat"
    echo "Пример:"
    echo "cp .env.example .env"
    echo "# Затем отредактируйте .env и добавьте ваш токен"
    exit 1
fi

# Проверяем, установлены ли зависимости
if [ ! -d "node_modules" ]; then
    echo "📦 Установка зависимостей..."
    npm install
fi

echo "🌐 Запуск сервера..."
echo "Приложение будет доступно по адресу: http://localhost:3000"

npm start 