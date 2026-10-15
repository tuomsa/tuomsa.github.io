const messages = document.getElementById('messages');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send');
const newChatBtn = document.getElementById('new-chat');
const historyList = document.getElementById('history-list');

const API_KEY = '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'; // ← keep your key
const MODEL = 'openrouter/free';

let currentChat = [];
let allChats = JSON.parse(localStorage.getItem('chatHistory') || '[]');

function saveHistory() {
  localStorage.setItem('chatHistory', JSON.stringify(allChats));
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  if (allChats.length === 0) {
    historyList.innerHTML = '<p style="color:#888;font-size:0.9rem;">No past chats yet</p>';
    return;
  }
  // Show newest first
  [...allChats].reverse().forEach((chat, i) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const preview = chat[0]?.content?.slice(0, 50) || 'Empty chat';
    div.textContent = preview + (preview.length >= 50 ? '…' : '');
    div.onclick = () => loadChat(allChats.length - 1 - i);
    historyList.appendChild(div);
  });
}

function loadChat(index) {
  currentChat = allChats[index] || [];
  messages.innerHTML = '';
  currentChat.forEach(msg => {
    addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot', false);
  });
}

function addMessage(text, type, save = true) {
  const div = document.createElement('div');
  div.className = `msg ${type}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  if (save) {
    currentChat.push({ role: type === 'user' ? 'user' : 'assistant', content: text });
  }
  return div;
}

async function getReply(userText) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...currentChat.slice(-10), // last 10 messages for context
        { role: 'user', content: userText }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'API error');
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'No reply';
}

async function handleSend() {
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  const thinking = addMessage('Thinking...', 'bot', false);

  try {
    const reply = await getReply(text);
    thinking.textContent = reply;
    currentChat.push({ role: 'assistant', content: reply });

    // Save or update this chat in history
    if (currentChat.length === 2) { // first exchange
      allChats.push([...currentChat]);
    } else {
      allChats[allChats.length - 1] = [...currentChat];
    }
    saveHistory();
  } catch (err) {
    thinking.textContent = 'Error: ' + (err.message || 'Something went wrong');
    console.error(err);
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

function startNewChat() {
  if (currentChat.length > 0) {
    // already saved during send
  }
  currentChat = [];
  messages.innerHTML = '';
  input.value = '';
  input.focus();
}

sendBtn.addEventListener('click', handleSend);
newChatBtn.addEventListener('click', startNewChat);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Initial load
renderHistory();