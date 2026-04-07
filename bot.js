const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const INSTANCE    = process.env.GREEN_API_INSTANCE;
const TOKEN       = process.env.GREEN_API_TOKEN;
const CLAUDE_KEY  = process.env.ANTHROPIC_API_KEY;
const MAIN_GROUP  = process.env.MAIN_GROUP_ID;
const TEST_GROUP  = process.env.TEST_GROUP_ID;
const PORT        = process.env.PORT || 3000;

const memory = [];

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const data = req.body;

  if (data.typeWebhook !== 'incomingMessageReceived') return;
  if (data.messageData?.typeMessage !== 'textMessage') return;

  const chatId  = data.senderData?.chatId;
  const sender  = data.senderData?.senderName || 'Неизвестный';
  const text    = data.messageData?.textMessageData?.textMessage;

  if (chatId !== MAIN_GROUP) return;
  if (!text) return;

  console.log(`Вопрос от ${sender}: ${text}`);

  try {
    const result = await askClaude(text);
    await sendToTest(sender, text, result.answer, result.confident);
    console.log(`Ответ отправлен в тестовую группу`);
  } catch (err) {
    console.error('Ошибка:', err.message);
  }
});

async function askClaude(question) {
  const context = memory.slice(-10)
    .map(m => `Вопрос: ${m.q}\nОтвет: ${m.a}`)
    .join('\n\n');

  const prompt =
    `Ты помощник компании. Отвечай на вопросы клиентов чётко и по делу.\n\n` +
    (context ? `Вот предыдущие вопросы и ответы для контекста:\n${context}\n\n` : '') +
    `Новый вопрос: "${question}"\n\n` +
    `Если знаешь ответ — дай его. ` +
    `Если не уверен — начни ответ ровно со слова НЕУВЕРЕН: и объясни что именно непонятно.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const json = await response.json();
  const answer = json.content?.[0]?.text || 'Не удалось получить ответ';
  const confident = !answer.startsWith('НЕУВЕРЕН:');

  if (confident) {
    memory.push({ q: question, a: answer });
    if (memory.length > 100) memory.shift();
  }

  return { answer, confident };
}

async function sendToTest(sender, question, answer, confident) {
  const icon   = confident ? '✅' : '⚠️';
  const status = confident ? 'Готов к отправке' : 'Нужна проверка';

  const message =
    `${icon} *${status}*\n\n` +
    `👤 *Спросил:* ${sender}\n` +
    `❓ *Вопрос:* ${question}\n\n` +
    `🤖 *Ответ бота:*\n${answer}`;

  await fetch(
    `https://api.greenapi.com/waInstance${INSTANCE}/sendMessage/${TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: TEST_GROUP, message })
    }
  );
}

app.listen(PORT, () => {
  console.log(`Бот запущен на порту ${PORT}`);
  console.log(`Основная группа: ${MAIN_GROUP}`);
  console.log(`Тестовая группа: ${TEST_GROUP}`);
});
