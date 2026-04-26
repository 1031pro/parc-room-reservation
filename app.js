/**
 * PARC ROOM STUDIO - 予約フォーム JavaScript
 */

// --- 設定 ---
const GAS_WEBAPP_URL = ''; // GASデプロイ後に設定
const LIFF_ID = '';        // LIFF追加後に設定

const PRICING = { weekday: 500, weekend: 600, midnight: 200 };
const MIN_SLOTS = 2;
const MAX_SLOTS = 10;
const SLOT_MINUTES = 30;
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// --- 状態管理 ---
let state = {
  currentStep: 1,
  date: '',
  dayOfWeek: -1,
  slots: [],
  selectedStartMinutes: -1,
  selectedStartTime: '',
  slotCount: MIN_SLOTS,
  name: '',
  phone: '',
  people: '1',
  payment: 'stripe',
  coupon: '',
  couponValid: false,
  discount: 0,
  totalPrice: 0,
  finalPrice: 0,
  userId: ''
};

// --- LIFF初期化 ---
document.addEventListener('DOMContentLoaded', function() {
  if (LIFF_ID) {
    liff.init({ liffId: LIFF_ID }).then(function() {
      if (liff.isLoggedIn()) {
        liff.getProfile().then(function(p) { state.userId = p.userId; });
      }
    }).catch(function(err) { console.warn('LIFF init error:', err); });
  }

  // 日付の初期値（明日）
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateInput = document.getElementById('dateInput');
  dateInput.min = formatDate(tomorrow);
  dateInput.value = formatDate(tomorrow);
  dateInput.addEventListener('change', onDateChange);

  // 支払い方法の切替
  document.querySelectorAll('input[name="payment"]').forEach(function(r) {
    r.addEventListener('change', onPaymentChange);
  });

  onDateChange();
});

function formatDate(d) {
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
}

// ============================================================
// JSONP API呼び出し
// ============================================================
function callGasApi(params, callback) {
  var cbName = 'gasCb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  var scriptEl;

  window[cbName] = function(data) {
    delete window[cbName];
    if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
    callback(null, data);
  };

  var url = GAS_WEBAPP_URL + '?callback=' + cbName;
  for (var key in params) {
    url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }

  scriptEl = document.createElement('script');
  scriptEl.src = url;
  scriptEl.onerror = function() {
    delete window[cbName];
    if (scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
    callback(new Error('API通信エラー'));
  };
  document.body.appendChild(scriptEl);
}

// ============================================================
// ステップ遷移
// ============================================================
function showStep(n) {
  document.querySelectorAll('.step-panel').forEach(function(p) { p.classList.remove('active'); });
  var target = n === 5 ? 'stepComplete' : 'step' + n;
  document.getElementById(target).classList.add('active');

  document.querySelectorAll('.progress-step').forEach(function(s) {
    var sn = parseInt(s.dataset.step);
    s.classList.toggle('active', sn <= n);
    s.classList.toggle('done', sn < n);
  });
  state.currentStep = n;
  window.scrollTo(0, 0);
}

function goBack(toStep) { showStep(toStep); }

// ============================================================
// Step 1: 日付選択
// ============================================================
function onDateChange() {
  var dateStr = document.getElementById('dateInput').value;
  if (!dateStr) return;
  state.date = dateStr;
  var d = new Date(dateStr + 'T00:00:00');
  state.dayOfWeek = d.getDay();

  var isWeekend = (state.dayOfWeek === 0 || state.dayOfWeek === 6);
  var dayType = isWeekend ? '土日' : '平日';
  var info = document.getElementById('dayInfo');
  info.innerHTML = '<strong>' + dateStr + '（' + DAY_NAMES[state.dayOfWeek] + '）' + dayType + '</strong><br>'
    + '通常時間帯(8:00-24:00): ¥' + (isWeekend ? '1,200' : '1,000') + '/時間<br>'
    + '深夜早朝(0:00-8:00): ¥400/時間';
}

function goToStep2() {
  if (!state.date) { alert('日付を選択してください'); return; }
  showStep(2);
  loadSlots();
}

// ============================================================
// Step 2: 時間・利用時間
// ============================================================
function loadSlots() {
  var grid = document.getElementById('slotGrid');
  grid.innerHTML = '<p class="loading">読み込み中...</p>';

  if (!GAS_WEBAPP_URL) {
    // GAS未設定時：ローカルデモ用
    renderSlotsLocal();
    return;
  }

  callGasApi({ action: 'slots', date: state.date }, function(err, data) {
    if (err || data.error) {
      grid.innerHTML = '<p class="loading">エラーが発生しました</p>';
      return;
    }
    state.slots = data.slots;
    renderSlots();
  });
}

function renderSlotsLocal() {
  // デモ用：全枠を空きとして生成
  state.slots = [];
  var d = new Date(state.date + 'T00:00:00');
  for (var t = 0; t < 24 * 60; t += SLOT_MINUTES) {
    var h = Math.floor(t / 60);
    var m = t % 60;
    var isWeekend = (state.dayOfWeek === 0 || state.dayOfWeek === 6);
    var price = h < 8 ? PRICING.midnight : (isWeekend ? PRICING.weekend : PRICING.weekday);
    state.slots.push({
      time: ('0'+h).slice(-2) + ':' + ('0'+m).slice(-2),
      minutes: t,
      available: true,
      pricePerSlot: price,
      timeCategory: h < 8 ? 'midnight' : 'daytime'
    });
  }
  renderSlots();
}

function renderSlots() {
  var grid = document.getElementById('slotGrid');
  grid.innerHTML = '';
  state.slots.forEach(function(slot) {
    var btn = document.createElement('button');
    btn.className = 'slot-btn' + (slot.available ? '' : ' disabled');
    btn.innerHTML = slot.time + '<span class="slot-price">¥' + slot.pricePerSlot + '</span>';
    if (slot.available) {
      btn.onclick = function() { selectSlot(slot); };
    }
    grid.appendChild(btn);
  });
}

function selectSlot(slot) {
  state.selectedStartMinutes = slot.minutes;
  state.selectedStartTime = slot.time;

  document.querySelectorAll('.slot-btn').forEach(function(b) { b.classList.remove('selected'); });
  // 選択範囲をハイライト
  updateSlotHighlight();
  updatePriceDisplay();
}

function changeDuration(delta) {
  var newCount = state.slotCount + delta;
  if (newCount < MIN_SLOTS || newCount > MAX_SLOTS) return;
  state.slotCount = newCount;
  document.getElementById('durationDisplay').textContent =
    (newCount * SLOT_MINUTES / 60) + '時間';
  updateSlotHighlight();
  updatePriceDisplay();
}

function updateSlotHighlight() {
  if (state.selectedStartMinutes < 0) return;
  var btns = document.querySelectorAll('.slot-btn');
  btns.forEach(function(b, i) {
    b.classList.remove('selected');
    var slot = state.slots[i];
    if (slot && slot.minutes >= state.selectedStartMinutes
        && slot.minutes < state.selectedStartMinutes + (state.slotCount * SLOT_MINUTES)) {
      b.classList.add('selected');
    }
  });

  var endMin = state.selectedStartMinutes + (state.slotCount * SLOT_MINUTES);
  var endStr = ('0' + Math.floor(endMin / 60)).slice(-2) + ':' + ('0' + (endMin % 60)).slice(-2);
  document.getElementById('timeRange').textContent = state.selectedStartTime + ' 〜 ' + endStr;
}

function updatePriceDisplay() {
  if (state.selectedStartMinutes < 0) return;
  var total = 0;
  var d = new Date(state.date + 'T00:00:00');
  for (var i = 0; i < state.slotCount; i++) {
    var slotMin = state.selectedStartMinutes + (i * SLOT_MINUTES);
    var h = slotMin / 60;
    var isWeekend = (state.dayOfWeek === 0 || state.dayOfWeek === 6);
    total += (h < 8) ? PRICING.midnight : (isWeekend ? PRICING.weekend : PRICING.weekday);
  }
  state.totalPrice = total;
  state.finalPrice = total;

  var el = document.getElementById('priceDisplay');
  el.innerHTML = '<div class="price-amount">¥' + total.toLocaleString() + '</div>'
    + '<div class="price-detail">' + (state.slotCount * SLOT_MINUTES / 60) + '時間 × 料金</div>';
}

function goToStep3() {
  if (state.selectedStartMinutes < 0) { alert('開始時間を選択してください'); return; }
  // 選択範囲に予約済み枠がないかチェック
  for (var i = 0; i < state.slotCount; i++) {
    var idx = state.slots.findIndex(function(s) {
      return s.minutes === state.selectedStartMinutes + (i * SLOT_MINUTES);
    });
    if (idx >= 0 && !state.slots[idx].available) {
      alert('選択した時間帯に予約済みの枠が含まれています'); return;
    }
  }
  showStep(3);
}

// ============================================================
// Step 3: お客様情報
// ============================================================
function onPaymentChange() {
  state.payment = document.querySelector('input[name="payment"]:checked').value;
  var couponArea = document.getElementById('couponArea');
  couponArea.style.display = state.payment === 'stripe' ? 'block' : 'none';
  if (state.payment !== 'stripe') {
    state.coupon = '';
    state.couponValid = false;
    state.discount = 0;
    state.finalPrice = state.totalPrice;
  }
}

function applyCoupon() {
  var code = document.getElementById('couponInput').value.trim();
  if (!code) return;
  var msg = document.getElementById('couponMessage');

  if (!GAS_WEBAPP_URL) {
    // ローカルデモ用
    msg.textContent = 'GAS未接続のためクーポン検証をスキップ';
    msg.className = 'coupon-msg invalid';
    return;
  }

  callGasApi({ action: 'validate_coupon', code: code }, function(err, data) {
    if (err || !data.valid) {
      msg.textContent = data ? data.message : 'エラー';
      msg.className = 'coupon-msg invalid';
      state.couponValid = false;
      state.finalPrice = state.totalPrice;
      return;
    }
    state.coupon = code;
    state.couponValid = true;
    var discount = 0;
    if (data.type === 'percent') {
      discount = Math.floor(state.totalPrice * data.value / 100);
    } else {
      discount = Math.min(data.value, state.totalPrice);
    }
    state.discount = discount;
    state.finalPrice = state.totalPrice - discount;
    msg.textContent = '✓ ' + data.description + '（-¥' + discount.toLocaleString() + '）';
    msg.className = 'coupon-msg valid';
  });
}

function goToStep4() {
  state.name = document.getElementById('nameInput').value.trim();
  state.phone = document.getElementById('phoneInput').value.trim();
  state.people = document.getElementById('peopleInput').value;

  if (!state.name) { alert('お名前を入力してください'); return; }
  if (!state.phone) { alert('電話番号を入力してください'); return; }

  renderConfirmation();
  showStep(4);
}

// ============================================================
// Step 4: 確認・予約確定
// ============================================================
function renderConfirmation() {
  var endMin = state.selectedStartMinutes + (state.slotCount * SLOT_MINUTES);
  var endStr = ('0' + Math.floor(endMin / 60)).slice(-2) + ':' + ('0' + (endMin % 60)).slice(-2);
  var duration = state.slotCount * SLOT_MINUTES / 60;

  var html = '<div class="confirm-row"><span class="label">利用日</span><span class="value">'
    + state.date + '（' + DAY_NAMES[state.dayOfWeek] + '）</span></div>'
    + '<div class="confirm-row"><span class="label">時間</span><span class="value">'
    + state.selectedStartTime + ' 〜 ' + endStr + '（' + duration + '時間）</span></div>'
    + '<div class="confirm-row"><span class="label">人数</span><span class="value">'
    + state.people + '名</span></div>'
    + '<div class="confirm-row"><span class="label">お名前</span><span class="value">'
    + state.name + '</span></div>'
    + '<div class="confirm-row"><span class="label">電話番号</span><span class="value">'
    + state.phone + '</span></div>'
    + '<div class="confirm-row"><span class="label">お支払い</span><span class="value">'
    + (state.payment === 'stripe' ? 'オンライン決済' : '現地払い') + '</span></div>';

  if (state.couponValid && state.discount > 0) {
    html += '<div class="confirm-row"><span class="label">クーポン</span><span class="value">-¥'
      + state.discount.toLocaleString() + '</span></div>';
  }

  html += '<div class="confirm-total"><span>合計</span><span>¥'
    + state.finalPrice.toLocaleString() + '</span></div>';

  document.getElementById('confirmDetails').innerHTML = html;

  var btn = document.getElementById('submitBtn');
  btn.textContent = state.payment === 'stripe' ? '決済に進む' : '予約を確定する';
}

function submitReservation() {
  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '処理中...';

  if (!GAS_WEBAPP_URL) {
    // ローカルデモ
    setTimeout(function() { showComplete({ reservationId: 'PR_DEMO', needsAccessCode: false }); }, 1000);
    return;
  }

  var params = {
    date: state.date,
    start_time: state.selectedStartTime,
    slots: state.slotCount,
    name: state.name,
    phone: state.phone,
    people: state.people,
    user_id: state.userId
  };

  if (state.payment === 'stripe') {
    params.action = 'create_checkout';
    params.coupon = state.coupon;
    callGasApi(params, function(err, data) {
      if (err || !data.success) {
        alert(data ? data.message : 'エラーが発生しました');
        btn.disabled = false;
        btn.textContent = '決済に進む';
        return;
      }
      // Stripe Checkoutページへ遷移
      window.location.href = data.checkoutUrl;
    });
  } else {
    params.action = 'submit';
    params.payment = 'onsite';
    callGasApi(params, function(err, data) {
      if (err || !data.success) {
        alert(data ? data.message : 'エラーが発生しました');
        btn.disabled = false;
        btn.textContent = '予約を確定する';
        return;
      }
      showComplete(data);
      sendLiffConfirmation(data);
    });
  }
}

// ============================================================
// 完了画面
// ============================================================
function showComplete(data) {
  var endMin = state.selectedStartMinutes + (state.slotCount * SLOT_MINUTES);
  var endStr = ('0' + Math.floor(endMin / 60)).slice(-2) + ':' + ('0' + (endMin % 60)).slice(-2);
  var duration = state.slotCount * SLOT_MINUTES / 60;

  var html = '<div class="confirm-row"><span class="label">予約番号</span><span class="value">'
    + data.reservationId + '</span></div>'
    + '<div class="confirm-row"><span class="label">利用日</span><span class="value">'
    + state.date + '（' + DAY_NAMES[state.dayOfWeek] + '）</span></div>'
    + '<div class="confirm-row"><span class="label">時間</span><span class="value">'
    + state.selectedStartTime + ' 〜 ' + endStr + '</span></div>'
    + '<div class="confirm-row"><span class="label">人数</span><span class="value">'
    + state.people + '名</span></div>'
    + '<div class="confirm-total"><span>合計</span><span>¥'
    + state.finalPrice.toLocaleString() + '</span></div>';

  document.getElementById('completeDetails').innerHTML = html;

  var note = document.getElementById('accessNote');
  if (data.needsAccessCode) {
    note.innerHTML = '🔑 21:00〜7:00のご利用はオートロックとなります。<br>暗証番号は別途LINEでご案内いたします。';
    note.style.display = 'block';
  } else {
    note.style.display = 'none';
  }

  showStep(5);
}

function sendLiffConfirmation(data) {
  if (typeof liff === 'undefined' || !liff.isInClient()) return;
  var endMin = state.selectedStartMinutes + (state.slotCount * SLOT_MINUTES);
  var endStr = ('0' + Math.floor(endMin / 60)).slice(-2) + ':' + ('0' + (endMin % 60)).slice(-2);

  liff.sendMessages([{
    type: 'text',
    text: '📅 予約が完了しました！\n\n'
      + '予約番号: ' + data.reservationId + '\n'
      + '日時: ' + state.date + ' ' + state.selectedStartTime + '-' + endStr + '\n'
      + '人数: ' + state.people + '名\n'
      + '金額: ¥' + state.finalPrice.toLocaleString() + '\n'
      + (state.payment === 'onsite' ? '\n💰 当日現地にてお支払いください' : '\n✅ 決済完了')
  }]).catch(function(e) { console.warn('sendMessages error:', e); });
}

function closeLiff() {
  if (typeof liff !== 'undefined' && liff.isInClient()) {
    liff.closeWindow();
  } else {
    window.close();
  }
}
