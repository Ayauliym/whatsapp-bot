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

  const chatIdClean = chatId ? chatId.replace('@g.us', '') : '';
  const mainGroupClean = MAIN_GROUP ? MAIN_GROUP.replace('@g.us', '') : '';
  const testGroupClean = TEST_GROUP ? TEST_GROUP.replace('@g.us', '') : '';

  console.log('Получено сообщение от ' + sender + ' из чата ' + chatIdClean + ': ' + text);

  if (chatIdClean === mainGroupClean) {
    console.log('Вопрос из основной группы от ' + sender + ': ' + text);
    try {
      const result = await askClaude(text);
      await sendToTest(sender, text, result.answer, result.confident);
      console.log('Отправлено в тестовую группу');
    } catch (err) {
      console.error
