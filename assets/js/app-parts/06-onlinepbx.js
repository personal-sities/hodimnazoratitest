// ============================================================
//  ONLINEPBX INTEGRATSIYASI VA OPERATORLAR MONITORINGI
// ============================================================

let pbxDateFrom = todayISO();
let pbxDateTo = todayISO();
let pbxFilterOperator = 'all';
let pbxFilterStatus = 'all';
let pbxStatsCache = null;
let pbxCallsCache = [];
let pbxAutoRefreshTimer = null;

function initOnlinePbx() {
  const fromEl = document.getElementById('pbx_date_from');
  const toEl = document.getElementById('pbx_date_to');
  if (fromEl && !fromEl.value) fromEl.value = todayISO();
  if (toEl && !toEl.value) toEl.value = todayISO();
  pbxDateFrom = fromEl?.value || todayISO();
  pbxDateTo = toEl?.value || todayISO();
}

async function loadPbxDashboard() {
  initOnlinePbx();
  startPbxAutoRefresh();
  await Promise.all([
    loadPbxOperatorFilterOptions(),
    fetchAndRenderPbxStats(),
    fetchAndRenderPbxCalls()
  ]);
  if (typeof hydrateLucideIcons === 'function') {
    hydrateLucideIcons(document.getElementById('tab_pbx'));
  }
}

function startPbxAutoRefresh() {
  if (pbxAutoRefreshTimer) clearInterval(pbxAutoRefreshTimer);
  // Har 25 soniyada yangilab turish (faqat PBX bo'limida bo'lsa)
  pbxAutoRefreshTimer = setInterval(() => {
    if (currentAdminTab === 'pbx') {
      fetchAndRenderPbxStats(true);
      fetchAndRenderPbxCalls(true);
    }
  }, 25000);
}

function setPbxDatePreset(preset) {
  const today = todayISO();
  const fromEl = document.getElementById('pbx_date_from');
  const toEl = document.getElementById('pbx_date_to');

  ['pbx_preset_today', 'pbx_preset_yesterday', 'pbx_preset_month'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  if (preset === 'today') {
    pbxDateFrom = today;
    pbxDateTo = today;
    document.getElementById('pbx_preset_today')?.classList.add('active');
  } else if (preset === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yStr = d.toISOString().split('T')[0];
    pbxDateFrom = yStr;
    pbxDateTo = yStr;
    document.getElementById('pbx_preset_yesterday')?.classList.add('active');
  } else if (preset === 'month') {
    const ym = today.substring(0, 7);
    pbxDateFrom = `${ym}-01`;
    pbxDateTo = today;
    document.getElementById('pbx_preset_month')?.classList.add('active');
  }

  if (fromEl) fromEl.value = pbxDateFrom;
  if (toEl) toEl.value = pbxDateTo;
  loadPbxDashboard();
}

function onPbxDateChange() {
  const fromEl = document.getElementById('pbx_date_from');
  const toEl = document.getElementById('pbx_date_to');
  pbxDateFrom = fromEl?.value || todayISO();
  pbxDateTo = toEl?.value || todayISO();
  if (pbxDateFrom > pbxDateTo) {
    pbxDateTo = pbxDateFrom;
    if (toEl) toEl.value = pbxDateTo;
  }
  loadPbxDashboard();
}

function onPbxFilterChange() {
  const opEl = document.getElementById('pbx_filter_operator');
  const stEl = document.getElementById('pbx_filter_status');
  pbxFilterOperator = opEl?.value || 'all';
  pbxFilterStatus = stEl?.value || 'all';
  fetchAndRenderPbxStats();
  fetchAndRenderPbxCalls();
}

function selectPbxOperator(opNum) {
  const sel = document.getElementById('pbx_filter_operator');
  if (sel) {
    sel.value = (sel.value === opNum) ? 'all' : opNum;
    onPbxFilterChange();
  }
}

async function loadPbxOperatorFilterOptions() {
  const sel = document.getElementById('pbx_filter_operator');
  if (!sel) return;
  const currentVal = sel.value || 'all';

  try {
    let emps = [];
    try {
      const sRes = await serverApi('/api/employees?active_only=true');
      if (sRes.ok && Array.isArray(sRes.data)) {
        emps = sRes.data;
      }
    } catch (_) {}

    if (!emps.length) {
      try {
        const res = await sb.from('employees').select('id,name,operator_number,pbx_extension').eq('active', true).order('name');
        if (!res.error && res.data) emps = res.data;
      } catch (_) {}
    }

    try {
      const localOps = JSON.parse(localStorage.getItem('aloqa_operator_numbers') || '{}');
      (emps || []).forEach(emp => {
        if (!emp.operator_number && localOps[emp.id]) {
          emp.operator_number = localOps[emp.id];
        }
      });
    } catch (_) {}

    sel.innerHTML = `<option value="all">${t('pbx_filter_all_ops') || 'Barcha operatorlar'}</option>`;
    const added = new Set();
    (emps || []).forEach(emp => {
      const opNum = String(emp.operator_number || emp.pbx_extension || '').trim();
      if (opNum && !added.has(opNum)) {
        added.add(opNum);
        const opt = document.createElement('option');
        opt.value = opNum;
        opt.textContent = `${opNum} — ${emp.name}`;
        sel.appendChild(opt);
      }
    });

    // Keshdagi qo'shimcha operatorlar
    (pbxStatsCache?.operators || []).forEach(op => {
      const opNum = String(op.operator_number || '').trim();
      if (opNum && opNum !== '—' && opNum !== 'other' && !added.has(opNum)) {
        added.add(opNum);
        const opt = document.createElement('option');
        opt.value = opNum;
        opt.textContent = `${opNum} — ${op.employee_name || 'Operator'}`;
        sel.appendChild(opt);
      }
    });

    if (currentVal && (currentVal === 'all' || added.has(currentVal))) {
      sel.value = currentVal;
    } else {
      sel.value = 'all';
      pbxFilterOperator = 'all';
    }
  } catch (e) {
    console.warn('loadPbxOperatorFilterOptions error:', e);
  }
}

function getPbxRatingColor(score) {
  const num = parseFloat(score);
  if (isNaN(num) || num <= 0) {
    return {
      text: 'var(--text3)',
      bg: 'var(--bg2)',
      border: 'var(--border2)',
      glow: 'transparent',
      label: '—'
    };
  }
  // 1, 2, 3 -> Qizil (Red)
  if (num < 3.5) {
    return {
      text: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.15)',
      border: 'rgba(239, 68, 68, 0.35)',
      glow: 'rgba(239, 68, 68, 0.45)',
      label: 'Qizil'
    };
  }
  // 4 -> Sariq (Yellow)
  if (num < 4.5) {
    return {
      text: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.15)',
      border: 'rgba(245, 158, 11, 0.35)',
      glow: 'rgba(245, 158, 11, 0.45)',
      label: 'Sariq'
    };
  }
  // 5 -> Yashil (Green)
  return {
    text: '#10b981',
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.35)',
    glow: 'rgba(16, 185, 129, 0.45)',
    label: 'Yashil'
  };
}

async function fetchAndRenderPbxStats(isBackground = false) {
  const totalEl = document.getElementById('pbx_stat_total');
  const ansEl = document.getElementById('pbx_stat_answered');
  const missEl = document.getElementById('pbx_stat_missed');
  const durEl = document.getElementById('pbx_stat_duration');
  const ratingEl = document.getElementById('pbx_stat_rating');
  const tbody = document.getElementById('pbx_operators_body');

  if (!isBackground && tbody && (!tbody.children.length || tbody.innerHTML.includes('skeleton'))) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text3);">${t('loading') || 'Yuklanmoqda...'}</td></tr>`;
  }

  try {
    const url = `/api/pbx/stats?from=${encodeURIComponent(pbxDateFrom)}&to=${encodeURIComponent(pbxDateTo)}&operator=${encodeURIComponent(pbxFilterOperator)}&status=${encodeURIComponent(pbxFilterStatus)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Stats API xatosi');
    const data = await res.json();
    pbxStatsCache = data;

    const summary = data.summary || {
      total_calls: 0,
      answered_calls: 0,
      missed_calls: 0,
      answered_percent: 0,
      total_talk_seconds: 0,
      avg_talk_seconds: 0,
      avg_rating: null,
      rated_calls_count: 0
    };

    if (totalEl) totalEl.textContent = summary.total_calls.toLocaleString();
    if (ansEl) ansEl.textContent = `${summary.answered_calls.toLocaleString()} (${summary.answered_percent}%)`;
    if (missEl) missEl.textContent = summary.missed_calls.toLocaleString();
    if (durEl) {
      const totHm = fmtPbxSeconds(summary.total_talk_seconds);
      const avgHm = fmtPbxSeconds(summary.avg_talk_seconds);
      durEl.textContent = `${totHm} / ${avgHm}`;
      durEl.title = `Jami: ${totHm}, O'rtacha (umumiy qo'ng'iroqlarga nisbatan): ${avgHm}`;
    }
    if (ratingEl) {
      const cardEl = ratingEl.closest('.scard');
      const titleEl = document.getElementById('pbx_card_rating_title');
      const iconEl = cardEl ? cardEl.querySelector('.scard-icon') : null;

      if (summary.avg_rating) {
        const rc = getPbxRatingColor(summary.avg_rating);
        ratingEl.textContent = `★ ${summary.avg_rating}`;
        ratingEl.style.color = rc.text;
        ratingEl.title = `${summary.rated_calls_count} ta baholangan qo'ng'iroq`;
        if (cardEl) {
          cardEl.style.borderColor = rc.border;
          cardEl.style.background = `linear-gradient(135deg, var(--card-bg) 0%, ${rc.bg} 100%)`;
        }
        if (titleEl) titleEl.style.color = rc.text;
        if (iconEl) iconEl.style.color = rc.text;
      } else {
        ratingEl.textContent = '—';
        ratingEl.style.color = 'var(--text3)';
        ratingEl.title = 'Hozircha baholanmagan';
        if (cardEl) {
          cardEl.style.borderColor = 'rgba(234,179,8,0.35)';
          cardEl.style.background = 'var(--card-bg)';
        }
        if (titleEl) titleEl.style.color = '#ca8a04';
        if (iconEl) iconEl.style.color = '#eab308';
      }
    }

    renderPbxOperatorsTable(data.operators || []);
  } catch (err) {
    console.error('fetchAndRenderPbxStats error:', err);
    if (!isBackground && tbody) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--danger);">${err.message || 'Xatolik yuz berdi'}</td></tr>`;
    }
  }
}

function renderPbxOperatorsTable(operators) {
  const tbody = document.getElementById('pbx_operators_body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let list = operators || [];
  if (pbxFilterOperator && pbxFilterOperator !== 'all') {
    list = list.filter(op => String(op.operator_number || '').trim() === String(pbxFilterOperator).trim());
  }

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text3);">${t('no_data') || 'Ma\'lumot yo\'q'}</td></tr>`;
    return;
  }

  list.forEach((op, idx) => {
    const tr = document.createElement('tr');
    const pct = op.answered_percent || 0;
    const pctColor = pct >= 80 ? 'var(--success)' : (pct >= 50 ? 'var(--warn)' : 'var(--danger)');
    const barWidth = Math.min(100, Math.max(0, pct));

    const totalTalkStr = fmtPbxSeconds(op.total_talk_seconds || 0);
    const avgTalkStr = fmtPbxSeconds(op.avg_talk_seconds || 0);

    const isCurrentOpSelected = (pbxFilterOperator === op.operator_number);
    const opBadge = op.operator_number && op.operator_number !== '—'
      ? `<span class="badge bsm ${isCurrentOpSelected ? 'bb' : 'bg'}" style="font-family:var(--mono);display:inline-flex;align-items:center;gap:4px;cursor:pointer;" onclick="selectPbxOperator('${op.operator_number}')" title="Faqat shu operatorni filtrlash">${getLucideIcon('phone', '', 12)} ${op.operator_number}</span>`
      : `<span class="badge bsm bgr">—</span>`;

    const empNameHtml = op.employee_id
      ? `<strong>${escapePbxHtml(op.employee_name)}</strong>`
      : `<span style="color:var(--text3);font-style:italic;">${escapePbxHtml(op.employee_name || 'Biriktirilmagan')}</span>`;

    const rc = getPbxRatingColor(op.avg_rating);
    const ratingBadge = op.avg_rating
      ? `<span class="badge bsm" style="background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};font-weight:700;display:inline-flex;align-items:center;gap:4px;" title="Reyting: ${op.avg_rating} (${rc.label})">★ ${op.avg_rating} <span style="font-size:10px;opacity:0.8;font-weight:400;">(${op.rated_calls_count})</span></span>`
      : `<span style="color:var(--text3);font-size:12px;">—</span>`;

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${opBadge}</td>
      <td>${empNameHtml}</td>
      <td><strong>${op.total_calls}</strong></td>
      <td><span class="badge bsm bg">${op.answered_calls}</span></td>
      <td><span class="badge bsm br">${op.missed_calls}</span></td>
      <td style="min-width:140px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:8px;background:var(--border2);border-radius:4px;overflow:hidden;">
            <div style="width:${barWidth}%;height:100%;background:${pctColor};border-radius:4px;transition:width .3s;"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:${pctColor};min-width:38px;">${pct}%</span>
        </div>
      </td>
      <td style="font-family:var(--mono);">${totalTalkStr}</td>
      <td style="font-family:var(--mono);" title="O'rtacha suhbat umumiy qo'ng'iroqlarga nisbatan">${avgTalkStr}</td>
      <td>${ratingBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function fetchAndRenderPbxCalls(isBackground = false) {
  const tbody = document.getElementById('pbx_calls_body');
  if (!isBackground && tbody && (!tbody.children.length || tbody.innerHTML.includes('skeleton'))) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text3);">${t('loading') || 'Yuklanmoqda...'}</td></tr>`;
  }

  try {
    const url = `/api/pbx/calls?from=${encodeURIComponent(pbxDateFrom)}&to=${encodeURIComponent(pbxDateTo)}&operator=${encodeURIComponent(pbxFilterOperator)}&status=${encodeURIComponent(pbxFilterStatus)}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Calls API xatosi');
    const data = await res.json();
    pbxCallsCache = data.calls || [];
    renderPbxCallsTable(pbxCallsCache);
  } catch (err) {
    console.error('fetchAndRenderPbxCalls error:', err);
    if (!isBackground && tbody) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--danger);">${err.message || 'Xatolik yuz berdi'}</td></tr>`;
    }
  }
}

function renderPbxCallsTable(calls) {
  const tbody = document.getElementById('pbx_calls_body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const query = (document.getElementById('pbx_search_input')?.value || '').toLowerCase().trim();
  const filtered = calls.filter(c => {
    if (!query) return true;
    return (
      (c.caller || '').toLowerCase().includes(query) ||
      (c.callee || '').toLowerCase().includes(query) ||
      (c.operator_number || '').toLowerCase().includes(query) ||
      (c.employee_name || '').toLowerCase().includes(query)
    );
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text3);">${t('no_data') || 'Qo\'ng\'iroqlar topilmadi'}</td></tr>`;
    return;
  }

  filtered.forEach((c, idx) => {
    const tr = document.createElement('tr');

    let timeStr = '—';
    if (c.started_at) {
      try {
        const d = new Date(c.started_at);
        timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' +
                  String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
      } catch (e) {}
    }

    const isAnswered = c.status === 'answered';
    const statusBadge = isAnswered
      ? `<span class="badge bsm bg" style="display:inline-flex;align-items:center;gap:4px;">${getLucideIcon('check-circle', '', 12)} ${t('pbx_stat_answered') || 'Gaplashilgan'}</span>`
      : `<span class="badge bsm br" style="display:inline-flex;align-items:center;gap:4px;">${getLucideIcon('phone-missed', '', 12)} ${t('pbx_stat_missed') || 'Propushnniy'}</span>`;

    const talkStr = isAnswered
      ? fmtPbxSeconds(c.talk_time || c.duration || 0)
      : '<span style="color:var(--text3);">0s</span>';

    const rVal = parseFloat(c.rating);
    let ratingHtml = '';
    if (!isNaN(rVal) && rVal > 0) {
      const rc = getPbxRatingColor(rVal);
      ratingHtml = `<button class="bsm" onclick="openRateCallModal('${c.call_id}','${escapePbxHtml(c.caller||'')}','${escapePbxHtml(c.employee_name||'')}',${rVal},'${escapePbxHtml(c.rating_comment||'')}')" style="background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:3px;border-radius:var(--radius-sm);padding:3px 8px;" title="${c.rating_comment ? escapePbxHtml(c.rating_comment) : 'Bahoni tahrirlash'}">★ ${rVal}</button>`;
    } else {
      ratingHtml = `<button class="bsm bg2" onclick="openRateCallModal('${c.call_id}','${escapePbxHtml(c.caller||'')}','${escapePbxHtml(c.employee_name||'')}',5,'')" style="font-size:11px;padding:3px 7px;cursor:pointer;" title="Baho qo'yish">+ Baholash</button>`;
    }

    const recHtml = c.record_url
      ? `<button class="bsm bg2" onclick="playPbxAudio('${escapePbxHtml(c.record_url)}')" title="Yozuvni tinglash" style="display:inline-flex;align-items:center;gap:4px;">${getLucideIcon('play', '', 12)} ${t('pbx_th_record') || 'Yozuv'}</button>`
      : '<span style="color:var(--text3);font-size:11px;">—</span>';

    const isOut = (c.direction === 'out' || (c.caller && String(c.caller).length <= 4 && c.callee && String(c.callee).length > 4));
    const clientPhone = isOut ? (c.callee || 'Noma\'lum') : (c.caller || 'Noma\'lum');
    const lineDisplay = isOut ? (c.caller || 'Chiquvchi') : (c.callee || '—');
    const dirBadge = isOut
      ? `<span class="badge bsm bb" style="font-size:10px;padding:2px 6px;display:inline-flex;align-items:center;gap:3px;" title="Chiquvchi qo'ng'iroq">${getLucideIcon('arrow-up-right', '', 11)} Chiq.</span>`
      : `<span class="badge bsm bg2" style="font-size:10px;padding:2px 6px;display:inline-flex;align-items:center;gap:3px;" title="Kiruvchi qo'ng'iroq">${getLucideIcon('arrow-down-left', '', 11)} Kir.</span>`;

    const isCurrentOpSelected = (pbxFilterOperator && pbxFilterOperator !== 'all' && c.operator_number === pbxFilterOperator);
    const opBadge = (c.operator_number && c.operator_number !== '—' && c.operator_number !== 'other')
      ? `<span class="badge bsm ${isCurrentOpSelected ? 'bb' : 'bg'}" style="font-family:var(--mono);display:inline-flex;align-items:center;gap:4px;cursor:pointer;" onclick="selectPbxOperator('${c.operator_number}')" title="Faqat shu operatorni filtrlash">${getLucideIcon('phone', '', 12)} ${c.operator_number}</span>`
      : `<span class="badge bsm bgr">—</span>`;

    const empNameHtml = (c.employee_name && c.employee_name !== '—' && c.employee_name !== 'Biriktirilmagan')
      ? `<strong>${escapePbxHtml(c.employee_name)}</strong>`
      : `<span style="color:var(--text3);font-style:italic;">Biriktirilmagan</span>`;

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="font-family:var(--mono);font-size:11.5px;">${timeStr}</td>
      <td style="font-family:var(--mono);font-weight:600;">
        <div style="display:inline-flex;align-items:center;gap:6px;">
          ${dirBadge}
          <span>${escapePbxHtml(clientPhone)}</span>
        </div>
      </td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--text2);">${escapePbxHtml(lineDisplay)}</td>
      <td>${opBadge}</td>
      <td>${empNameHtml}</td>
      <td>${statusBadge}</td>
      <td style="font-family:var(--mono);">${talkStr}</td>
      <td>${ratingHtml}</td>
      <td>${recHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function relinkPbxCallsManual() {
  const btn = document.getElementById('pbx_relink_btn');
  const btnTxt = document.getElementById('pbx_relink_btn_text');
  const origTxt = btnTxt ? btnTxt.textContent : '';
  if (btn) btn.disabled = true;
  if (btnTxt) btnTxt.textContent = 'Biriktirilmoqda...';

  try {
    toast('info', 'OnlinePBX', "Qo'ng'iroqlar xodimlarga qayta biriktirilmoqda...");
    const res = await fetch('/api/pbx/relink', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      toast('success', 'OnlinePBX', `Muvaffaqiyatli! ${data.updated_count || 0} ta qo'ng'iroq xodimlarga biriktirildi.`);
      await loadPbxDashboard();
    } else {
      toast('error', 'OnlinePBX', data.error || 'Qayta biriktirishda xatolik yuz berdi');
    }
  } catch (e) {
    toast('error', 'OnlinePBX', e.message || 'Serverga ulanishda xato');
  } finally {
    if (btn) btn.disabled = false;
    if (btnTxt) btnTxt.textContent = origTxt;
  }
}

function filterPbxCallsLocally() {
  renderPbxCallsTable(pbxCallsCache);
}

function fmtPbxSeconds(sec) {
  sec = Math.max(0, parseInt(sec, 10) || 0);
  if (sec === 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function escapePbxHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function playPbxAudio(url) {
  if (!url) return;
  const audio = new Audio(url);
  audio.play().catch(e => {
    toast('warn', 'Audio', 'Brauzer avtomatik ijro eta olmadi. Havola: ' + url);
    window.open(url, '_blank');
  });
}

// ============================================================
//  WEBHOOK MODALI VA SINUVDAN O'TKAZISH (TEST CALL)
// ============================================================

function openPbxWebhookModal() {
  const modal = document.getElementById('m_pbx_webhook');
  if (!modal) return;
  const urlInp = document.getElementById('pbx_webhook_url_display');
  if (urlInp) {
    urlInp.value = `${window.location.origin}/api/onlinepbx/webhook`;
  }
  loadPbxTestOperatorOptions();
  modal.classList.remove('hidden');
}

function closePbxWebhookModal() {
  const modal = document.getElementById('m_pbx_webhook');
  if (modal) modal.classList.add('hidden');
}

function copyPbxWebhookUrl() {
  const urlInp = document.getElementById('pbx_webhook_url_display');
  if (!urlInp) return;
  navigator.clipboard.writeText(urlInp.value).then(() => {
    toast('success', 'OnlinePBX Webhook', 'Webhook URL xotiraga nusxalandi!');
  }).catch(() => {
    urlInp.select();
    document.execCommand('copy');
    toast('success', 'OnlinePBX Webhook', 'Webhook URL xotiraga nusxalandi!');
  });
}

async function loadPbxTestOperatorOptions() {
  const sel = document.getElementById('pbx_test_op');
  if (!sel) return;
  try {
    let emps = null;
    const res = await sb.from('employees').select('id,name,operator_number').eq('active', true).order('name');
    if (!res.error && res.data) emps = res.data;
    if (!emps) {
      const fallback = await sb.from('employees').select('id,name').eq('active', true).order('name');
      emps = fallback.data || [];
    }

    try {
      const localOps = JSON.parse(localStorage.getItem('aloqa_operator_numbers') || '{}');
      (emps || []).forEach(emp => {
        if (!emp.operator_number && localOps[emp.id]) {
          emp.operator_number = localOps[emp.id];
        }
      });
    } catch (_) {}

    sel.innerHTML = '';
    let hasAny = false;
    (emps || []).forEach(emp => {
      if (emp.operator_number) {
        hasAny = true;
        const opt = document.createElement('option');
        opt.value = emp.operator_number;
        opt.textContent = `${emp.operator_number} — ${emp.name}`;
        sel.appendChild(opt);
      }
    });
    if (!hasAny) {
      sel.innerHTML = `<option value="100">100 — Standart operator</option>`;
    }
  } catch (e) {
    sel.innerHTML = `<option value="100">100 — Standart operator</option>`;
  }
}

async function sendTestPbxCall() {
  const op = document.getElementById('pbx_test_op')?.value || '100';
  const status = document.getElementById('pbx_test_status')?.value || 'answered';
  const talkSec = status === 'answered' ? (parseInt(document.getElementById('pbx_test_talk')?.value, 10) || 75) : 0;
  const ratingVal = parseInt(document.getElementById('pbx_test_rating')?.value || '5', 10);
  const rating = ratingVal > 0 ? ratingVal : null;
  const btn = document.getElementById('btn_send_test_call');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/onlinepbx/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator: op,
        status,
        talk_time: talkSec,
        rating,
        caller: `+99890${Math.floor(1000000 + Math.random() * 9000000)}`
      })
    });
    const result = await res.json();
    if (result.ok) {
      toast('success', 'OnlinePBX Test', `Sinov qo'ng'irog'i muvaffaqiyatli qabul qilindi! (Operator: ${op}, Holat: ${status}${rating ? ', Baho: ' + rating : ''})`);
      closePbxWebhookModal();
      await loadPbxDashboard();
    } else {
      toast('error', 'OnlinePBX Test', result.error || 'Xatolik yuz berdi');
    }
  } catch (e) {
    toast('error', 'OnlinePBX Test', e.message || 'Serverga ulanishda xato');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================
//  QO'NG'IROQNI BAHOLASH (CALL RATING MODAL)
// ============================================================

function openRateCallModal(callId, caller, empName, currentRating = 5, currentComment = '') {
  const modal = document.getElementById('m_rate_call');
  if (!modal) return;

  document.getElementById('rate_modal_call_id').value = callId || '';
  document.getElementById('rate_modal_caller').textContent = caller || '—';
  document.getElementById('rate_modal_emp').textContent = empName || '—';
  document.getElementById('rate_modal_comment').value = currentComment || '';

  const initialScore = Math.max(1, Math.min(5, parseInt(currentRating, 10) || 5));
  setRateModalScore(initialScore);

  modal.classList.remove('hidden');
}

function closeRateCallModal() {
  const modal = document.getElementById('m_rate_call');
  if (modal) modal.classList.add('hidden');
}

function setRateModalScore(score) {
  score = Math.max(1, Math.min(5, parseInt(score, 10) || 5));
  const hiddenInput = document.getElementById('rate_modal_score_val');
  if (hiddenInput) hiddenInput.value = score;

  const rc = getPbxRatingColor(score);
  const labels = {
    1: "1 - Yomon (Qizil)",
    2: "2 - Qoniqarsiz (Qizil)",
    3: "3 - O'rtacha (Qizil)",
    4: "4 - Yaxshi (Sariq)",
    5: "5 - A'lo (Yashil)"
  };
  const labelEl = document.getElementById('rate_score_text');
  if (labelEl) {
    labelEl.textContent = labels[score] || `${score}`;
    labelEl.style.color = rc.text;
  }

  for (let i = 1; i <= 5; i++) {
    const star = document.getElementById(`star_${i}`);
    if (star) {
      const active = (i <= score);
      star.style.color = active ? rc.text : 'var(--text3)';
      star.style.textShadow = active ? `0 0 12px ${rc.glow}` : 'none';
      star.style.transform = active ? 'scale(1.15)' : 'scale(1)';
      star.style.transition = 'all .2s ease';
    }
  }

  const modalHeader = document.querySelector('#m_rate_call .modal h3');
  if (modalHeader) {
    modalHeader.style.color = rc.text;
  }
}

async function saveCallRating() {
  const callId = document.getElementById('rate_modal_call_id')?.value;
  const rating = parseInt(document.getElementById('rate_modal_score_val')?.value || '5', 10);
  const comment = document.getElementById('rate_modal_comment')?.value?.trim() || '';

  if (!callId) {
    toast('warn', 'Baholash', 'Qo\'ng\'iroq ID topilmadi');
    return;
  }

  const btn = document.getElementById('btn_save_call_rating');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/pbx/rate-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: callId, rating, comment })
    });
    const result = await res.json();
    if (result.ok) {
      toast('success', 'Baholash', `Qo'ng'iroqqa baho saqlandi: ★ ${rating}`);
      closeRateCallModal();
      fetchAndRenderPbxStats(true);
      fetchAndRenderPbxCalls(true);
    } else {
      toast('error', 'Baholash', result.error || 'Saqlashda xatolik');
    }
  } catch (err) {
    toast('error', 'Baholash', err.message || 'Serverga ulanishda xato');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================
//  EXCELGA YUKLASH
// ============================================================

function exportPbxExcel() {
  if (!pbxStatsCache || !pbxStatsCache.operators || !pbxStatsCache.operators.length) {
    toast('warn', 'OnlinePBX', t('no_data') || 'Eksport uchun ma\'lumot yo\'q');
    return;
  }
  if (typeof XLSX === 'undefined') {
    toast('warn', 'OnlinePBX', 'XLSX kutubxonasi yuklanmoqda, kuting...');
    return;
  }

  const headers = [
    '#',
    t('pbx_th_op') || 'Operator',
    t('pbx_th_emp') || 'Mas\'ul xodim',
    t('pbx_th_total') || 'Jami qo\'ng\'iroqlar',
    t('pbx_th_answered') || 'Gaplashilgan',
    t('pbx_th_missed') || 'Propushnniy',
    t('pbx_th_percent') || 'Qabul foizi (%)',
    t('pbx_th_talk_time') || 'Jami suhbat vaqti',
    t('pbx_th_avg') || 'O\'rtacha suhbat vaqti',
    'Qo\'yilgan baho (Reyting)'
  ];

  const rows = pbxStatsCache.operators.map((op, i) => [
    i + 1,
    op.operator_number || '—',
    op.employee_name || '—',
    op.total_calls || 0,
    op.answered_calls || 0,
    op.missed_calls || 0,
    `${op.answered_percent || 0}%`,
    fmtPbxSeconds(op.total_talk_seconds || 0),
    fmtPbxSeconds(op.avg_talk_seconds || 0),
    op.avg_rating ? `★ ${op.avg_rating} (${op.rated_calls_count})` : '—'
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  const sheetName = `PBX_${pbxDateFrom}_${pbxDateTo}`.substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `AloqaPro_OnlinePBX_${pbxDateFrom}_${pbxDateTo}.xlsx`);
  toast('success', 'OnlinePBX', 'Excel hisoboti yuklab olindi!');
}
