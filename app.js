const classroom = document.querySelector('#classroom');
const deskLayer = document.querySelector('#deskLayer');
const deskCount = document.querySelector('#deskCount');
const numberInput = document.querySelector('#numberInput');
const numberCount = document.querySelector('#numberCount');
const validationMessage = document.querySelector('#validationMessage');
const selectedDeskLabel = document.querySelector('#selectedDeskLabel');
const statusText = document.querySelector('#statusText');
const overlay = document.querySelector('#drawOverlay');
const lotteryBall = document.querySelector('#lotteryBall');
const drawKicker = document.querySelector('#drawKicker');
const drawTitle = document.querySelector('#drawTitle');
const nextRevealButton = document.querySelector('#nextRevealButton');
const closeOverlayButton = document.querySelector('#closeOverlayButton');
const seatRevealPanel = document.querySelector('#seatRevealPanel');
const seatRevealBadge = document.querySelector('#seatRevealBadge');
const seatRevealMessage = document.querySelector('#seatRevealMessage');
const classroomNextButton = document.querySelector('#classroomNextButton');
const toast = document.querySelector('#toast');
const confettiCanvas = document.querySelector('#confettiCanvas');
const confettiContext = confettiCanvas.getContext('2d');

const DESK_WIDTH = 84;
const DESK_HEIGHT = 56;
const STORAGE_KEY = 'classroom-seat-picker-v1';

let desks = [];
let selectedId = null;
let drawMode = 'all';
let revealQueue = [];
let revealDeskQueue = [];
let revealIndex = 0;
let confettiPieces = [];
let confettiFrame = null;

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultLayout(count = 20) {
  const cols = count <= 20 ? 5 : 6;
  const rows = Math.ceil(count / cols);
  const xGap = cols === 5 ? 15.5 : 13.5;
  const xStart = cols === 5 ? 19 : 15.5;
  const yStart = 34;
  const yGap = Math.min(15, 55 / Math.max(rows - 1, 1));

  return Array.from({ length: count }, (_, index) => ({
    id: uid(),
    x: xStart + (index % cols) * xGap,
    y: yStart + Math.floor(index / cols) * yGap,
    rotation: 0,
    number: null,
  }));
}

function parseNumbers(raw) {
  const tokens = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const result = [];

  for (const token of tokens) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end || end - start > 99) return { numbers: [], error: '번호 범위를 다시 확인해 주세요.' };
      for (let value = start; value <= end; value += 1) result.push(String(value));
      continue;
    }
    if (!/^\d+$/.test(token)) return { numbers: [], error: '숫자, 쉼표, 범위(-)만 입력할 수 있어요.' };
    result.push(String(Number(token)));
  }

  if (new Set(result).size !== result.length) return { numbers: [], error: '같은 번호가 두 번 들어 있어요.' };
  return { numbers: result, error: '' };
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function render() {
  deskLayer.innerHTML = '';
  desks.forEach((desk, index) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `student-desk${desk.id === selectedId ? ' selected' : ''}`;
    element.dataset.id = desk.id;
    element.setAttribute('aria-label', `${index + 1}번 책상${desk.number ? `, 학생 번호 ${desk.number}` : ''}`);
    element.style.left = `calc(${desk.x}% - ${DESK_WIDTH / 2}px)`;
    element.style.top = `calc(${desk.y}% - ${DESK_HEIGHT / 2}px)`;
    element.style.transform = `rotate(${desk.rotation}deg)`;
    element.innerHTML = `<span class="desk-top"><span class="seat-number${desk.number ? '' : ' mystery'}">${desk.number ?? '?'}</span></span>`;
    bindDeskInteractions(element, desk);
    deskLayer.append(element);
  });

  deskCount.textContent = desks.length;
  document.querySelector('#emptyHint').classList.toggle('visible', desks.length === 0);
  const selectedIndex = desks.findIndex((desk) => desk.id === selectedId);
  selectedDeskLabel.textContent = selectedIndex >= 0 ? `${selectedIndex + 1}번 책상 선택됨` : '책상을 선택해 주세요';
  statusText.textContent = desks.some((desk) => desk.number) ? '자리 배정 완료' : '배치 편집 중';
}

function bindDeskInteractions(element, desk) {
  let startX = 0;
  let startY = 0;
  let originX = desk.x;
  let originY = desk.y;
  let moved = false;

  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    selectedId = desk.id;
    startX = event.clientX;
    startY = event.clientY;
    originX = desk.x;
    originY = desk.y;
    moved = false;
    element.setPointerCapture(event.pointerId);
    element.classList.add('dragging', 'selected');
    renderSelectionOnly();
  });

  element.addEventListener('pointermove', (event) => {
    if (!element.hasPointerCapture(event.pointerId)) return;
    const bounds = classroom.getBoundingClientRect();
    const dx = ((event.clientX - startX) / bounds.width) * 100;
    const dy = ((event.clientY - startY) / bounds.height) * 100;
    moved ||= Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3;
    desk.x = Math.max(6, Math.min(94, originX + dx));
    desk.y = Math.max(24, Math.min(94, originY + dy));
    element.style.left = `calc(${desk.x}% - ${DESK_WIDTH / 2}px)`;
    element.style.top = `calc(${desk.y}% - ${DESK_HEIGHT / 2}px)`;
  });

  const finish = (event) => {
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    element.classList.remove('dragging');
    if (moved) {
      const snapped = getSnappedPosition(desk);
      desk.x = snapped.x;
      desk.y = snapped.y;
      element.classList.add('settling');
      element.style.left = `calc(${desk.x}% - ${DESK_WIDTH / 2}px)`;
      element.style.top = `calc(${desk.y}% - ${DESK_HEIGHT / 2}px)`;
      setTimeout(() => element.classList.remove('settling'), 260);
      saveLocal(false);
    }
  };
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
}

function getSnappedPosition(desk) {
  const others = desks.filter((item) => item.id !== desk.id);
  const snapDistance = 3.5;

  const snapAxis = (value, candidates) => {
    const nearest = candidates.reduce((best, candidate) => {
      const distance = Math.abs(candidate - value);
      return distance < best.distance ? { value: candidate, distance } : best;
    }, { value, distance: Infinity });

    if (nearest.distance <= snapDistance) return nearest.value;
    return Math.round(value / 2.5) * 2.5;
  };

  return {
    x: Math.max(6, Math.min(94, snapAxis(desk.x, others.map((item) => item.x)))),
    y: Math.max(24, Math.min(94, snapAxis(desk.y, others.map((item) => item.y)))),
  };
}

function renderSelectionOnly() {
  document.querySelectorAll('.student-desk').forEach((element) => {
    element.classList.toggle('selected', element.dataset.id === selectedId);
  });
  const index = desks.findIndex((desk) => desk.id === selectedId);
  selectedDeskLabel.textContent = index >= 0 ? `${index + 1}번 책상 선택됨` : '책상을 선택해 주세요';
}

function rotateSelected(delta = 45) {
  const desk = desks.find((item) => item.id === selectedId);
  if (!desk) {
    showToast('먼저 회전할 책상을 선택해 주세요.');
    return;
  }
  desk.rotation = (desk.rotation + delta + 360) % 360;
  render();
  saveLocal(false);
}

function addDesk() {
  if (desks.length >= 36) return showToast('책상은 최대 36개까지 만들 수 있어요.');
  const index = desks.length;
  desks.push({ id: uid(), x: 20 + (index % 5) * 15, y: 35 + (Math.floor(index / 5) % 5) * 14, rotation: 0, number: null });
  selectedId = desks.at(-1).id;
  render();
}

function removeDesk() {
  if (!desks.length) return;
  const index = selectedId ? desks.findIndex((desk) => desk.id === selectedId) : desks.length - 1;
  desks.splice(index >= 0 ? index : desks.length - 1, 1);
  selectedId = null;
  render();
}

function validateNumbers() {
  const parsed = parseNumbers(numberInput.value);
  numberCount.textContent = `${parsed.numbers.length}명`;
  if (parsed.error) {
    validationMessage.textContent = parsed.error;
  } else if (parsed.numbers.length !== desks.length) {
    validationMessage.textContent = `책상 ${desks.length}개와 번호 ${parsed.numbers.length}개의 수가 달라요.`;
  } else {
    validationMessage.textContent = '';
  }
  return parsed;
}

function startDraw() {
  const parsed = validateNumbers();
  if (parsed.error || parsed.numbers.length !== desks.length || !desks.length) {
    showToast(!desks.length ? '먼저 책상을 추가해 주세요.' : '책상 수와 학생 번호 수를 맞춰 주세요.');
    numberInput.focus();
    return;
  }

  desks.forEach((desk) => { desk.number = null; });
  revealQueue = shuffled(parsed.numbers);
  revealDeskQueue = shuffled(desks.map((desk) => desk.id));
  revealIndex = 0;
  seatRevealPanel.classList.remove('show');
  classroom.classList.remove('reveal-stage');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  lotteryBall.classList.add('spinning');
  nextRevealButton.hidden = true;
  closeOverlayButton.hidden = true;
  drawKicker.textContent = '행운의 자리를 찾는 중...';
  drawTitle.textContent = '번호들이 교실을 여행하고 있어요!';

  let tickerIndex = 0;
  const ticker = setInterval(() => {
    lotteryBall.textContent = revealQueue[tickerIndex % revealQueue.length];
    tickerIndex += 1;
  }, 75);

  setTimeout(() => {
    clearInterval(ticker);
    lotteryBall.classList.remove('spinning');
    if (drawMode === 'all') revealAll();
    else revealNext();
  }, 1350);
}

function revealAll() {
  lotteryBall.textContent = '짠!';
  drawKicker.textContent = '두근두근, 자리 공개!';
  drawTitle.textContent = '새로운 짝꿍과 즐거운 하루 보내요!';
  revealDeskQueue.forEach((deskId, index) => {
    const desk = desks.find((item) => item.id === deskId);
    desk.number = revealQueue[index];
  });
  render();
  revealDeskQueue.forEach((deskId, index) => {
    setTimeout(() => {
      const element = document.querySelector(`[data-id="${deskId}"]`);
      element.classList.add('revealing');
      setTimeout(() => element.classList.remove('revealing'), 700);
    }, index * 55);
  });
  closeOverlayButton.hidden = false;
  launchConfetti();
  saveLocal(false);
}

function revealNext() {
  if (revealIndex >= desks.length) {
    drawKicker.textContent = '모든 자리를 찾았어요!';
    drawTitle.textContent = '새로운 짝꿍과 즐거운 하루 보내요!';
    nextRevealButton.hidden = true;
    closeOverlayButton.hidden = false;
    launchConfetti();
    saveLocal(false);
    return;
  }

  const number = revealQueue[revealIndex];
  const desk = desks.find((item) => item.id === revealDeskQueue[revealIndex]);
  desk.number = number;
  lotteryBall.textContent = number;
  drawKicker.textContent = `${revealIndex + 1}번째 자리의 주인공은`;
  drawTitle.textContent = `${number}번, 자리를 찾았어요!`;
  revealIndex += 1;
  nextRevealButton.hidden = false;
  nextRevealButton.innerHTML = '자리에서 확인하기 <span>→</span>';
  render();
}

function showRevealedSeat() {
  if (!revealIndex) return;
  closeOverlay();

  const desk = desks.find((item) => item.id === revealDeskQueue[revealIndex - 1]);
  classroom.classList.add('reveal-stage');
  seatRevealBadge.textContent = `${revealIndex}번째 자리 배정 완료`;
  seatRevealMessage.textContent = `${desk.number}번이 자리를 찾았어요!`;
  classroomNextButton.innerHTML = revealIndex < desks.length
    ? '다음 번호 뽑기 <span>→</span>'
    : '자리뽑기 완료 <span>✓</span>';
  seatRevealPanel.classList.add('show');

  requestAnimationFrame(() => {
    const element = document.querySelector(`[data-id="${desk.id}"]`);
    element?.classList.add('placement-focus');
  });

  if (revealIndex >= desks.length) {
    launchConfetti();
    saveLocal(false);
  }
}

function spinNextNumber() {
  seatRevealPanel.classList.remove('show');
  classroom.classList.remove('reveal-stage');

  if (revealIndex >= desks.length) {
    document.querySelectorAll('.student-desk').forEach((element) => element.classList.remove('placement-focus'));
    statusText.textContent = '자리 배정 완료';
    return;
  }

  document.querySelectorAll('.student-desk').forEach((element) => element.classList.remove('placement-focus'));
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  lotteryBall.classList.add('spinning');
  nextRevealButton.hidden = true;
  closeOverlayButton.hidden = true;
  drawKicker.textContent = `${revealIndex + 1}번째 자리의 주인공을 찾는 중...`;
  drawTitle.textContent = '다음 번호가 빙글빙글 돌고 있어요!';

  const remaining = revealQueue.slice(revealIndex);
  let tickerIndex = 0;
  const ticker = setInterval(() => {
    lotteryBall.textContent = remaining[tickerIndex % remaining.length];
    tickerIndex += 1;
  }, 75);

  setTimeout(() => {
    clearInterval(ticker);
    lotteryBall.classList.remove('spinning');
    revealNext();
  }, 900);
}

function closeOverlay() {
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

function clearAssignments() {
  desks.forEach((desk) => { desk.number = null; });
  seatRevealPanel.classList.remove('show');
  classroom.classList.remove('reveal-stage');
  render();
  saveLocal(false);
  showToast('배정된 번호를 모두 지웠어요.');
}

function saveLocal(notify = true) {
  const state = { desks, numbers: numberInput.value, board: document.querySelector('.blackboard div').textContent };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (notify) showToast('현재 교실을 이 브라우저에 저장했어요.');
}

function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved?.desks?.length) return false;
    desks = saved.desks;
    numberInput.value = saved.numbers || `1-${desks.length}`;
    if (saved.board) document.querySelector('.blackboard div').textContent = saved.board;
    return true;
  } catch {
    return false;
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function launchConfetti() {
  const colors = ['#dcef87', '#ff765e', '#72bfdb', '#f3bb62', '#ffffff'];
  confettiCanvas.width = window.innerWidth * devicePixelRatio;
  confettiCanvas.height = window.innerHeight * devicePixelRatio;
  confettiContext.scale(devicePixelRatio, devicePixelRatio);
  confettiPieces = Array.from({ length: 130 }, () => ({
    x: Math.random() * window.innerWidth,
    y: -20 - Math.random() * window.innerHeight * .3,
    size: 5 + Math.random() * 8,
    speed: 2 + Math.random() * 4,
    sway: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  cancelAnimationFrame(confettiFrame);
  animateConfetti();
}

function animateConfetti() {
  confettiContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  let active = false;
  confettiPieces.forEach((piece) => {
    piece.y += piece.speed;
    piece.sway += .04;
    piece.rotation += .06;
    piece.x += Math.sin(piece.sway) * .8;
    if (piece.y < window.innerHeight + 20) active = true;
    confettiContext.save();
    confettiContext.translate(piece.x, piece.y);
    confettiContext.rotate(piece.rotation);
    confettiContext.fillStyle = piece.color;
    confettiContext.fillRect(-piece.size / 2, -piece.size / 3, piece.size, piece.size * .65);
    confettiContext.restore();
  });
  if (active) confettiFrame = requestAnimationFrame(animateConfetti);
  else confettiContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

document.querySelector('#addDeskButton').addEventListener('click', addDesk);
document.querySelector('#removeDeskButton').addEventListener('click', removeDesk);
document.querySelector('#rotateLeftButton').addEventListener('click', () => rotateSelected(-45));
document.querySelector('#rotateRightButton').addEventListener('click', () => rotateSelected(45));
document.querySelector('#resetLayoutButton').addEventListener('click', () => {
  const count = desks.length || 20;
  desks = defaultLayout(count);
  selectedId = null;
  render();
  validateNumbers();
  showToast('책상을 반듯하게 정리했어요.');
});
document.querySelector('#drawButton').addEventListener('click', startDraw);
document.querySelector('#clearButton').addEventListener('click', clearAssignments);
document.querySelector('#saveButton').addEventListener('click', () => saveLocal(true));
document.querySelector('#fullscreenButton').addEventListener('click', async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  else await document.exitFullscreen();
});
document.querySelectorAll('.option-chip').forEach((button) => {
  button.addEventListener('click', () => {
    drawMode = button.dataset.mode;
    document.querySelectorAll('.option-chip').forEach((item) => item.classList.toggle('active', item === button));
  });
});
document.querySelectorAll('.example-button').forEach((button) => {
  button.addEventListener('click', () => {
    numberInput.value = button.dataset.value;
    validateNumbers();
  });
});
numberInput.addEventListener('input', validateNumbers);
nextRevealButton.addEventListener('click', showRevealedSeat);
classroomNextButton.addEventListener('click', spinNextNumber);
closeOverlayButton.addEventListener('click', closeOverlay);

document.addEventListener('keydown', (event) => {
  const activeElement = document.activeElement;
  const isEditingText = activeElement?.matches('input, textarea') || activeElement?.isContentEditable;
  if (!isEditingText && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    rotateSelected(-45);
  }
  if (!isEditingText && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    rotateSelected(45);
  }
  if (event.key === 'Escape' && overlay.classList.contains('open') && !closeOverlayButton.hidden) closeOverlay();
});

const boardText = document.querySelector('.blackboard [contenteditable]');
let boardSaveTimer;
boardText.addEventListener('input', () => {
  clearTimeout(boardSaveTimer);
  boardSaveTimer = setTimeout(() => saveLocal(false), 350);
});
boardText.addEventListener('blur', () => saveLocal(false));

if (!loadLocal()) desks = defaultLayout(20);
render();
validateNumbers();
