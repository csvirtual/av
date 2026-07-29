// Relógio e Calendário: relógio analógico/digital, cronômetro, timer (com
// som ao terminar) e um calendário mensal com notas por dia, persistidas.
import { playNotifyChime } from '../core/services/sounds.js';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function pad(n) {
  return String(n).padStart(2, '0');
}
function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatDuration(ms) {
  const totalCentis = Math.floor(ms / 10);
  const centis = totalCentis % 100;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const base = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  return `${base},${pad(centis)}`;
}

export function openClock(ctx) {
  const { windows, kv } = ctx;

  const root = document.createElement('div');
  root.className = 'clockapp';
  root.innerHTML = `
    <div class="clockapp-tabs">
      <button data-tab="clock" class="active">🕒 Relógio</button>
      <button data-tab="calendar">📅 Calendário</button>
    </div>
    <div class="clockapp-content" data-role="content"></div>
  `;

  const win = windows.createWindow({
    appId: 'clock',
    title: 'Relógio e Calendário',
    icon: '🕒',
    width: 420,
    height: 560,
    content: root,
  });

  const content = root.querySelector('[data-role="content"]');
  let activeIntervals = [];
  function every(fn, ms) {
    const id = setInterval(fn, ms);
    activeIntervals.push(id);
    return id;
  }
  function clearActiveIntervals() {
    activeIntervals.forEach(clearInterval);
    activeIntervals = [];
  }
  win.onClose(() => clearActiveIntervals());

  // ---------------- Relógio ----------------
  function renderClockTab() {
    clearActiveIntervals();
    content.innerHTML = `
      <div class="analog-clock" data-role="analog">
        <div class="hand hour" data-role="hour"></div>
        <div class="hand minute" data-role="minute"></div>
        <div class="hand second" data-role="second"></div>
        <div class="analog-center"></div>
      </div>
      <div class="digital-clock" data-role="digital">--:--:--</div>
      <div class="digital-date" data-role="digital-date"></div>

      <h2>Cronômetro</h2>
      <div class="stopwatch-display" data-role="sw-display">00:00,00</div>
      <div class="clockapp-actions">
        <button class="btn" data-action="sw-toggle">Iniciar</button>
        <button class="btn" style="background:var(--hover);color:var(--text)" data-action="sw-lap">Marcar</button>
        <button class="btn" style="background:var(--hover);color:var(--text)" data-action="sw-reset">Zerar</button>
      </div>
      <ul class="lap-list" data-role="laps"></ul>

      <h2>Timer</h2>
      <div class="clockapp-actions">
        <input type="number" min="1" max="180" value="5" data-role="timer-minutes" style="width:70px">
        <span style="font-size:13px;color:var(--text-dim)">minutos</span>
      </div>
      <div class="stopwatch-display" data-role="timer-display">05:00</div>
      <div class="clockapp-actions">
        <button class="btn" data-action="timer-toggle">Iniciar</button>
        <button class="btn" style="background:var(--hover);color:var(--text)" data-action="timer-reset">Zerar</button>
      </div>
    `;

    function tickAnalog() {
      const now = new Date();
      const h = now.getHours() % 12;
      const m = now.getMinutes();
      const s = now.getSeconds();
      content.querySelector('[data-role="hour"]').style.transform = `rotate(${h * 30 + m * 0.5}deg)`;
      content.querySelector('[data-role="minute"]').style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
      content.querySelector('[data-role="second"]').style.transform = `rotate(${s * 6}deg)`;
      const digital = content.querySelector('[data-role="digital"]');
      if (digital) {
        digital.textContent = now.toLocaleTimeString('pt-BR', { hour12: ctx.getTimeFormat() === '12h' });
      }
      const digitalDate = content.querySelector('[data-role="digital-date"]');
      if (digitalDate) {
        digitalDate.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
    }
    tickAnalog();
    every(tickAnalog, 1000);

    // Cronômetro
    let swElapsed = 0;
    let swRunning = false;
    let swStart = 0;
    const swDisplay = content.querySelector('[data-role="sw-display"]');
    const lapsEl = content.querySelector('[data-role="laps"]');
    function swCurrent() {
      return swElapsed + (swRunning ? Date.now() - swStart : 0);
    }
    every(() => {
      if (swRunning) swDisplay.textContent = formatDuration(swCurrent());
    }, 30);
    content.querySelector('[data-action="sw-toggle"]').addEventListener('click', (e) => {
      if (swRunning) {
        swElapsed = swCurrent();
        swRunning = false;
        e.target.textContent = 'Continuar';
      } else {
        swStart = Date.now();
        swRunning = true;
        e.target.textContent = 'Pausar';
      }
    });
    content.querySelector('[data-action="sw-lap"]').addEventListener('click', () => {
      const li = document.createElement('li');
      li.textContent = formatDuration(swCurrent());
      lapsEl.prepend(li);
    });
    content.querySelector('[data-action="sw-reset"]').addEventListener('click', () => {
      swElapsed = 0;
      swRunning = false;
      swDisplay.textContent = formatDuration(0);
      lapsEl.innerHTML = '';
      content.querySelector('[data-action="sw-toggle"]').textContent = 'Iniciar';
    });

    // Timer
    let timerRemaining = 5 * 60 * 1000;
    let timerRunning = false;
    let timerDeadline = 0;
    const timerDisplay = content.querySelector('[data-role="timer-display"]');
    const minutesInput = content.querySelector('[data-role="timer-minutes"]');
    function renderTimer(ms) {
      const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
      timerDisplay.textContent = `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
    }
    renderTimer(timerRemaining);
    every(() => {
      if (!timerRunning) return;
      const remaining = timerDeadline - Date.now();
      if (remaining <= 0) {
        timerRunning = false;
        timerRemaining = 0;
        renderTimer(0);
        content.querySelector('[data-action="timer-toggle"]').textContent = 'Iniciar';
        playNotifyChime();
        return;
      }
      timerRemaining = remaining;
      renderTimer(remaining);
    }, 250);
    content.querySelector('[data-action="timer-toggle"]').addEventListener('click', (e) => {
      if (timerRunning) {
        timerRemaining = timerDeadline - Date.now();
        timerRunning = false;
        e.target.textContent = 'Continuar';
      } else {
        if (timerRemaining <= 0) timerRemaining = Math.max(1, parseFloat(minutesInput.value) || 1) * 60 * 1000;
        timerDeadline = Date.now() + timerRemaining;
        timerRunning = true;
        e.target.textContent = 'Pausar';
      }
    });
    content.querySelector('[data-action="timer-reset"]').addEventListener('click', () => {
      timerRunning = false;
      timerRemaining = Math.max(1, parseFloat(minutesInput.value) || 1) * 60 * 1000;
      renderTimer(timerRemaining);
      content.querySelector('[data-action="timer-toggle"]').textContent = 'Iniciar';
    });
    minutesInput.addEventListener('change', () => {
      if (!timerRunning) {
        timerRemaining = Math.max(1, parseFloat(minutesInput.value) || 1) * 60 * 1000;
        renderTimer(timerRemaining);
      }
    });
  }

  // ---------------- Calendário ----------------
  let viewMonth = new Date().getMonth();
  let viewYear = new Date().getFullYear();
  let selectedDate = new Date();

  async function renderCalendarTab() {
    clearActiveIntervals();
    const notes = await kv.get('calendar.notes', {});
    const today = new Date();
    const firstDay = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const startWeekday = firstDay.getDay();

    content.innerHTML = `
      <div class="calendar-header">
        <button class="icon-btn" data-action="prev-month" aria-label="Mês anterior">‹</button>
        <strong>${MONTHS[viewMonth]} ${viewYear}</strong>
        <button class="icon-btn" data-action="next-month" aria-label="Próximo mês">›</button>
      </div>
      <div class="calendar-grid calendar-weekdays">
        ${WEEKDAYS.map((w) => `<div class="calendar-weekday">${w}</div>`).join('')}
      </div>
      <div class="calendar-grid" data-role="days"></div>
      <h2 style="margin-top:16px" data-role="note-heading"></h2>
      <textarea data-role="note-text" placeholder="Escreva uma nota para este dia..." rows="3"></textarea>
      <button class="btn" data-action="save-note" style="margin-top:8px">Salvar nota</button>
    `;

    const daysEl = content.querySelector('[data-role="days"]');
    for (let i = 0; i < startWeekday; i++) daysEl.appendChild(document.createElement('div'));
    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(viewYear, viewMonth, day);
      const key = dateKey(cellDate);
      const cell = document.createElement('button');
      cell.className = 'calendar-day';
      if (cellDate.toDateString() === today.toDateString()) cell.classList.add('today');
      if (cellDate.toDateString() === selectedDate.toDateString()) cell.classList.add('selected');
      cell.innerHTML = `<span>${day}</span>${notes[key] ? '<span class="calendar-dot"></span>' : ''}`;
      cell.addEventListener('click', () => {
        selectedDate = cellDate;
        renderCalendarTab();
      });
      daysEl.appendChild(cell);
    }

    const selKey = dateKey(selectedDate);
    content.querySelector('[data-role="note-heading"]').textContent =
      `Nota de ${selectedDate.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    content.querySelector('[data-role="note-text"]').value = notes[selKey] || '';

    content.querySelector('[data-action="prev-month"]').addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendarTab();
    });
    content.querySelector('[data-action="next-month"]').addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendarTab();
    });
    content.querySelector('[data-action="save-note"]').addEventListener('click', async () => {
      const text = content.querySelector('[data-role="note-text"]').value.trim();
      const all = await kv.get('calendar.notes', {});
      if (text) all[selKey] = text;
      else delete all[selKey];
      await kv.set('calendar.notes', all);
      renderCalendarTab();
    });
  }

  const renderers = { clock: renderClockTab, calendar: renderCalendarTab };
  root.querySelectorAll('.clockapp-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.clockapp-tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderers[btn.dataset.tab]();
    });
  });

  renderClockTab();
  return win;
}
