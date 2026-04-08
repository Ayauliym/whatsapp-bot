require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

const INSTANCE   = process.env.GREEN_API_INSTANCE;
const TOKEN      = process.env.GREEN_API_TOKEN;
const API_URL    = process.env.GREEN_API_URL;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const MAIN_GROUP = process.env.MAIN_GROUP_ID;
const TEST_GROUP = process.env.TEST_GROUP_ID;
const PORT       = process.env.PORT || 3000;

// Убирает @g.us если есть
function cleanId(id) {
  return id ? id.replace('@g.us', '') : '';
}

// Добавляет @g.us для отправки через Green API
function toGroupChatId(id) {
  const clean = cleanId(id);
  return clean ? clean + '@g.us' : '';
}

const memory = [];

const SYSTEM_PROMPT = `Ты — помощник менеджера по ценообразованию компании Sulpak (Казахстан).

Твоя задача: анализировать вопросы сотрудников магазинов и предлагать ответ менеджерам для проверки.

ПРАВИЛА:
— Если цена на сайте отличается от цены на полке: запроси правильную цену у менеджера
— Если вопрос про скидку любого размера: сообщи что нужно уточнение у менеджера по ценообразованию
— Если товар пробили по неверной цене: предложи уточнить правильную цену у менеджера
— По любому другому вопросу о ценах: предложи вариант ответа и попроси менеджера проверить

ВАЖНО:
— Отвечай на том языке на котором написал сотрудник (русский или казахский)
— Будь чётким и коротким
— Если совсем не знаешь что ответить — напиши НЕУВЕРЕН: и объясни почему`;

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const data = req.body;

  if (data.typeWebhook !== 'incomingMessageReceived') return;
  if (data.messageData?.typeMessage !== 'textMessage') return;

  const chatId = data.senderData?.chatId;
  const sender = data.senderData?.senderName || 'Неизвестный';
  const text   = data.messageData?.textMessageData?.textMessage;

  if (!text) return;

  const chatIdClean    = cleanId(chatId);
  const mainGroupClean = cleanId(MAIN_GROUP);
  const testGroupClean = cleanId(TEST_GROUP);

  console.log('Получено сообщение от ' + sender + ' из чата ' + chatIdClean + ': ' + text);

  if (chatIdClean === mainGroupClean) {
    console.log('Вопрос из основной группы от ' + sender + ': ' + text);
    try {
      const result = await askClaude(text);
      await sendToTest(sender, text, result.answer, result.confident);
      console.log('Отправлено в тестовую группу');
    } catch (err) {
      console.error('Ошибка:', err.message);
    }
    return;
  }

  if (chatIdClean === testGroupClean) {
    console.log('Вопрос из тестовой группы от ' + sender + ': ' + text);
    try {
      const result = await askClaude(text);
      await sendToTestDirect(sender, text, result.answer, result.confident);
      console.log('Ответ отправлен в тестовую группу');
    } catch (err) {
      console.error('Ошибка:', err.message);
    }
    return;
  }

  console.log('Сообщение из неизвестного чата: ' + chatIdClean + ' — игнорируем');
});

async function askClaude(question) {
  const context = memory.slice(-10)
    .map(function(m) { return 'Вопрос: ' + m.q + '\nОтвет: ' + m.a; })
    .join('\n\n');

  const userMessage = (context ? 'Предыдущие вопросы для контекста:\n' + context + '\n\n' : '') +
    'Новый вопрос: "' + question + '"';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  const json = await response.json();

  if (json.error) {
    console.error('Ошибка Claude API:', json.error);
    throw new Error(json.error.message || 'Claude API error');
  }

  const answer = json.content && json.content[0] ? json.content[0].text : 'Не удалось получить ответ';
  const confident = !answer.startsWith('НЕУВЕРЕН:');

  if (confident) {
    memory.push({ q: question, a: answer });
    if (memory.length > 100) memory.shift();
  }

  return { answer: answer, confident: confident };
}

async function sendToTest(sender, question, answer, confident) {
  const icon = confident ? '✅ УВЕРЕН' : '⚠️ НУЖНА ПРОВЕРКА';
  const msg1 = '❓ Новый вопрос из основной группы\nОт: ' + sender + '\n\n' + question;
  const msg2 = icon + '\n\nПредлагаемый ответ:\n' + answer + '\n\nМенеджер, проверьте и подскажите правильный ответ';

  await sendMessage(toGroupChatId(TEST_GROUP), msg1);
  await new Promise(function(r) { setTimeout(r, 1000); });
  await sendMessage(toGroupChatId(TEST_GROUP), msg2);
}

async function sendToTestDirect(sender, question, answer, confident) {
  const icon = confident ? '✅ УВЕРЕН' : '⚠️ НУЖНА ПРОВЕРКА';
  const msg = icon + '\n\nОтвет на вопрос "' + question + '":\n' + answer;
  await sendMessage(toGroupChatId(TEST_GROUP), msg);
}

async function sendMessage(chatId, message) {
  const url = API_URL + '/waInstance' + INSTANCE + '/sendMessage/' + TOKEN;
  console.log('Отправляю в chatId: ' + chatId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: chatId, message: message })
  });
  const result = await response.json();
  console.log('Ответ Green API: ' + JSON.stringify(result));
}

app.listen(PORT, function() {
  console.log('Бот запущен на порту ' + PORT);
  console.log('Основная группа: ' + toGroupChatId(MAIN_GROUP));
  console.log('Тестовая группа: ' + toGroupChatId(TEST_GROUP));
});

