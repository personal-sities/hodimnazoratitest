// ============================================================
//  SAMARQAND ONLINEPBX INTEGRATSIYASI VA MONITORINGI
// ============================================================

let samarkandPbxDateFrom = todayISO();
let samarkandPbxDateTo = todayISO();
let samarkandPbxFilterOperator = 'all';
let samarkandPbxFilterStatus = 'all';
let samarkandPbxStatsCache = null;
let samarkandPbxAutoRefreshTimer = null;

function initSamarkandOnlinePbx() {
  const fromEl = document.getElementById('samarkand_pbx_date_from');
  const toEl = document.getElementById('samarkand_pbx_date_to');
  if (fromEl && !fromEl.value) fromEl.value = todayISO();
  if (toEl && !toEl.value) toEl.value = todayISO();
  samarkandPbxDateFrom = fromEl?.value || todayISO();
  samarkandPbxDateTo = toEl?.value || todayISO();
}

async function loadSamarkandPbxDashboard() {
  initSamarkandOnlinePbx();
  startSamarkandPbxAutoRefresh();
  loadSamarkandPbxOperatorFilterOptions();
  await fetchAndRenderSamarkandPbxStats(false);
}

function startSamarkandPbxAutoRefresh() {
  if (samarkandPbxAutoRefreshTimer) clearInterval(samarkandPbxAutoRefreshTimer);
  samarkandPbxAutoRefreshTimer = setInterval(() => {
    const isTabVisible = !document.getElementById('tab_samarkand_pbx')?.classList.contains('hidden');
    if ((isTabVisible || (typeof currentAdminTab !== 'undefined' && currentAdminTab === 'samarkand_pbx')) && samarkandPbxDateTo >= todayISO()) {
      fetchAndRenderSamarkandPbxStats(true).catch(() => {});
    }
  }, 10000);
}

function setSamarkandPbxDatePreset(preset) {
  const today = todayISO();
  const fromEl = document.getElementById('samarkand_pbx_date_from');
  const toEl = document.getElementById('samarkand_pbx_date_to');

  ['samarkand_pbx_preset_today', 'samarkand_pbx_preset_yesterday', 'samarkand_pbx_preset_month'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  if (preset === 'today') {
    samarkandPbxDateFrom = today;
    samarkandPbxDateTo = today;
    document.getElementById('samarkand_pbx_preset_today')?.classList.add('active');
  } else if (preset === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yStr = d.toISOString().split('T')[0];
    samarkandPbxDateFrom = yStr;
    samarkandPbxDateTo = yStr;
    document.getElementById('samarkand_pbx_preset_yesterday')?.classList.add('active');
  } else if (preset === 'month') {
    const ym = today.substring(0, 7);
    samarkandPbxDateFrom = `${ym}-01`;
    samarkandPbxDateTo = today;
    document.getElementById('samarkand_pbx_preset_month')?.classList.add('active');
  }

  if (fromEl) fromEl.value = samarkandPbxDateFrom;
  if (toEl) toEl.value = samarkandPbxDateTo;

  fetchAndRenderSamarkandPbxStats(false);
}

function onSamarkandPbxDateChange() {
  const fromEl = document.getElementById('samarkand_pbx_date_from');
  const toEl = document.getElementById('samarkand_pbx_date_to');
  samarkandPbxDateFrom = fromEl?.value || todayISO();
  samarkandPbxDateTo = toEl?.value || todayISO();
  if (samarkandPbxDateFrom > samarkandPbxDateTo) {
    samarkandPbxDateTo = samarkandPbxDateFrom;
    if (toEl) toEl.value = samarkandPbxDateTo;
  }
  fetchAndRenderSamarkandPbxStats(false);
}

function onSamarkandPbxFilterChange() {
  const opEl = document.getElementById('samarkand_pbx_filter_operator');
  const stEl = document.getElementById('samarkand_pbx_filter_status');
  samarkandPbxFilterOperator = opEl?.value || 'all';
  samarkandPbxFilterStatus = stEl?.value || 'all';
  fetchAndRenderSamarkandPbxStats(false);
}

function selectSamarkandPbxOperator(opNum) {
  const sel = document.getElementById('samarkand_pbx_filter_operator');
  if (sel) {
    sel.value = (sel.value === opNum) ? 'all' : opNum;
    onSamarkandPbxFilterChange();
  }
}

async function loadSamarkandPbxOperatorFilterOptions() {
  const sel = document.getElementById('samarkand_pbx_filter_operator');
  if (!sel) return;
  const currentVal = sel.value || 'all';

  try {
    let emps = [];
    try {
      const sRes = await serverApi('/api/employees?active_only=true');
      if (sRes.ok && Array.isArray(sRes.data)) emps = sRes.data;
    } catch (_) {}

    const knownOps = (samarkandPbxStatsCache?.operators || []).map(o => o.operator_number).filter(Boolean);
    const opList = Array.from(new Set(['100', '101', '102', '103', '104', '105', '106', '5002', ...knownOps]));

    sel.innerHTML = `<option value="all">${t('pbx_filter_all_ops') || 'Barcha operatorlar'}</option>`;
    opList.forEach(opNum => {
      const emp = emps.find(e => String(e.operator_number || e.pbx_extension || '').trim() === opNum);
      const name = emp ? emp.name : (opNum === '5002' ? '5002-operator' : 'Operator');
      const opt = document.createElement('option');
      opt.value = opNum;
      opt.textContent = `${opNum} — ${name}`;
      sel.appendChild(opt);
    });

    if (currentVal && (currentVal === 'all' || opList.includes(currentVal))) {
      sel.value = currentVal;
    } else {
      sel.value = 'all';
      samarkandPbxFilterOperator = 'all';
    }
  } catch (e) {
    console.warn('loadSamarkandPbxOperatorFilterOptions error:', e);
  }
}

function getSamarkandPbxRatingColor(score) {
  const num = parseFloat(score);
  if (isNaN(num) || num <= 0) {
    return { text: 'var(--text3)', bg: 'var(--bg2)', border: 'var(--border2)', label: '—' };
  }
  if (num < 3.5) {
    return { text: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.35)', label: 'Qizil' };
  }
  if (num < 4.5) {
    return { text: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.35)', label: 'Sariq' };
  }
  return { text: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.35)', label: 'Yashil' };
}

function renderSamarkandPbxStatsUI(data) {
  if (!data) return;
  const totalEl = document.getElementById('samarkand_pbx_stat_total');
  const ansEl = document.getElementById('samarkand_pbx_stat_answered');
  const missEl = document.getElementById('samarkand_pbx_stat_missed');
  const durEl = document.getElementById('samarkand_pbx_stat_duration');
  const ratingEl = document.getElementById('samarkand_pbx_stat_rating');

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

  if (totalEl) totalEl.textContent = (summary.total_calls || 0).toLocaleString();
  if (ansEl) ansEl.textContent = `${(summary.answered_calls || 0).toLocaleString()} (${summary.answered_percent || 0}%)`;
  if (missEl) missEl.textContent = (summary.missed_calls || 0).toLocaleString();
  if (durEl) {
    const totHm = fmtPbxSeconds(summary.total_talk_seconds || 0);
    const avgHm = fmtPbxSeconds(summary.avg_talk_seconds || 0);
    durEl.textContent = `${totHm} / ${avgHm}`;
    durEl.title = `Jami: ${totHm}, O'rtacha: ${avgHm}`;
  }

  const formulaX = document.getElementById('samarkand_pbx_formula_x');
  const formulaAcc = document.getElementById('samarkand_pbx_formula_acc_count');
  const formulaZ = document.getElementById('samarkand_pbx_formula_z');
  if (formulaX) formulaX.textContent = (summary.total_calls || 0).toLocaleString();
  if (formulaAcc) formulaAcc.textContent = `${summary.accounts_count || 0} ta`;
  if (formulaZ) {
    const zVal = summary.target_quota != null ? summary.target_quota : (Math.round(((summary.total_calls || 0) / Math.max(1, summary.accounts_count || 1)) * 10) / 10);
    formulaZ.textContent = (zVal || 0).toLocaleString();
  }

  if (ratingEl) {
    const cardEl = ratingEl.closest('.scard');
    const titleEl = document.getElementById('samarkand_pbx_card_rating_title');
    const iconEl = cardEl ? cardEl.querySelector('.scard-icon') : null;

    if (summary.avg_rating) {
      const rc = getSamarkandPbxRatingColor(summary.avg_rating);
      ratingEl.textContent = `★ ${summary.avg_rating}`;
      ratingEl.style.color = rc.text;
      ratingEl.title = `${summary.rated_calls_count || 0} ta baholangan qo'ng'iroq`;
      if (cardEl) {
        cardEl.style.borderColor = rc.border;
        cardEl.style.background = `linear-gradient(135deg, var(--card-bg) 0%, ${rc.bg} 100%)`;
      }
      if (titleEl) titleEl.style.color = rc.text;
      if (iconEl) iconEl.style.color = rc.text;
    } else {
      ratingEl.textContent = '—';
      ratingEl.style.color = 'var(--text3)';
      if (cardEl) {
        cardEl.style.borderColor = 'rgba(234,179,8,0.35)';
        cardEl.style.background = 'var(--card-bg)';
      }
      if (titleEl) titleEl.style.color = '#ca8a04';
      if (iconEl) iconEl.style.color = '#eab308';
    }
  }

  renderSamarkandPbxOperatorsTable(data.operators || []);
}

async function fetchAndRenderSamarkandPbxStats(isBackground = false) {
  const tbody = document.getElementById('samarkand_pbx_operators_body');

  if (!isBackground && tbody && (!tbody.children.length || tbody.innerHTML.includes('skeleton'))) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text3);">${t('loading') || 'Yuklanmoqda...'}</td></tr>`;
  }

  try {
    const url = `/api/samarkand-pbx/stats?from=${encodeURIComponent(samarkandPbxDateFrom)}&to=${encodeURIComponent(samarkandPbxDateTo)}&operator=${encodeURIComponent(samarkandPbxFilterOperator)}&status=${encodeURIComponent(samarkandPbxFilterStatus)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.ok) {
      samarkandPbxStatsCache = data;
      renderSamarkandPbxStatsUI(data);
    }
  } catch (err) {
    console.error('fetchAndRenderSamarkandPbxStats error:', err);
    if (!isBackground && tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--danger);">${err.message || 'Xatolik yuz berdi'}</td></tr>`;
    }
  }
}

function renderSamarkandPbxOperatorsTable(operators) {
  const tbody = document.getElementById('samarkand_pbx_operators_body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let list = operators || [];
  if (samarkandPbxFilterOperator && samarkandPbxFilterOperator !== 'all') {
    list = list.filter(op => String(op.operator_number || '').trim() === String(samarkandPbxFilterOperator).trim());
  }

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text3);">${t('no_data') || 'Ma\'lumot yo\'q'}</td></tr>`;
    return;
  }

  const totalX = samarkandPbxStatsCache?.summary?.total_calls || 0;
  const accountsCount = Math.max(1, samarkandPbxStatsCache?.summary?.accounts_count || list.length);
  const targetQuotaPerAccount = samarkandPbxStatsCache?.summary?.target_quota != null 
    ? samarkandPbxStatsCache.summary.target_quota 
    : (Math.round((totalX / accountsCount) * 10) / 10);

  list.forEach((op, idx) => {
    const tr = document.createElement('tr');
    const is5002 = (String(op.operator_number || '').trim() === '5002');
    const targetQuota = is5002 ? null : (op.target_quota != null ? op.target_quota : targetQuotaPerAccount);
    const pct = op.answered_percent;
    const pctVal = typeof pct === 'number' ? pct : 0;
    const pctColor = pctVal >= 80 ? 'var(--success)' : (pctVal >= 50 ? 'var(--warn)' : 'var(--danger)');
    const barWidth = Math.min(100, Math.max(0, pctVal));

    const totalTalkStr = fmtPbxSeconds(op.total_talk_seconds || 0);
    const avgTalkStr = fmtPbxSeconds(op.avg_talk_seconds || 0);

    const isCurrentOpSelected = (samarkandPbxFilterOperator === op.operator_number);
    const opBadge = op.operator_number && op.operator_number !== '—'
      ? `<span class="badge bsm ${isCurrentOpSelected ? 'bb' : 'bg'}" style="font-family:var(--mono);display:inline-flex;align-items:center;gap:4px;cursor:pointer;" onclick="selectSamarkandPbxOperator('${op.operator_number}')" title="Faqat shu operatorni filtrlash">${typeof getLucideIcon === 'function' ? getLucideIcon('phone', '', 12) : '📞'} ${op.operator_number}</span>`
      : `<span class="badge bsm bgr">—</span>`;

    const empNameHtml = op.employee_id
      ? `<strong>${escapePbxHtml(op.employee_name)}</strong>`
      : `<span style="color:var(--text3);font-style:italic;">${escapePbxHtml(op.employee_name || 'Biriktirilmagan')}</span>`;

    const rc = getSamarkandPbxRatingColor(op.avg_rating);
    const ratingBadge = op.avg_rating
      ? `<span class="badge bsm" style="background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};font-weight:700;display:inline-flex;align-items:center;gap:4px;" title="Reyting: ${op.avg_rating}">★ ${op.avg_rating} <span style="font-size:10px;opacity:0.8;font-weight:400;">(${op.rated_calls_count || 0})</span></span>`
      : `<span style="color:var(--text3);font-size:12px;">—</span>`;

    const normaSubtitle = is5002
      ? ''
      : `<div style="font-size:10.5px;color:var(--text3);margin-top:2px;" title="Har bir akkaunt normasi: Z = X (${totalX}) / ${accountsCount} = ${targetQuota}">norma: ${targetQuota}</div>`;

    let percentColHtml = '';
    if (is5002 || targetQuota == null || pct == null) {
      percentColHtml = `<span style="color:var(--text3);font-size:12px;">—</span>`;
    } else {
      percentColHtml = `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:8px;background:var(--border2);border-radius:4px;overflow:hidden;" title="${pctVal}%">
            <div style="width:${barWidth}%;height:100%;background:${pctColor};border-radius:4px;transition:width .3s;"></div>
          </div>
          <span style="font-size:12px;font-weight:700;color:${pctColor};min-width:44px;">${pctVal}%</span>
        </div>
      `;
    }

    const incomingDisplay = (op.total_calls && op.total_calls > 0) ? op.total_calls : totalX;

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${opBadge}</td>
      <td>${empNameHtml}</td>
      <td>
        <strong title="Samarqandga kelgan umumiy kiruvchi qo'ng'iroqlar">${incomingDisplay}</strong>
        ${normaSubtitle}
      </td>
      <td><span class="badge bsm bg">${op.answered_calls || 0}</span></td>
      <td style="min-width:140px;" title="${is5002 ? 'Texnik liniya' : `Formula: Y (${op.answered_calls || 0}) / Z (${targetQuota}) × 100% = ${pctVal}%`}">${percentColHtml}</td>
      <td style="font-family:var(--mono);">${totalTalkStr}</td>
      <td style="font-family:var(--mono);" title="O'rtacha suhbat vaqti">${avgTalkStr}</td>
      <td>${ratingBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function syncSamarkandPbxFromApiManual() {
  const btn = document.getElementById('samarkand_pbx_sync_api_btn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-icon spin" data-lucide="loader-2"></span><span>Sinxronlanmoqda...</span>`;
    if (typeof hydrateLucideIcons === 'function') hydrateLucideIcons(btn);
  }
  try {
    if (typeof toast === 'function') toast('info', 'Samarqand OnlinePBX', 'Yangi qo\'ng\'iroqlar yuklanmoqda...');
    const fromVal = samarkandPbxDateFrom || todayISO();
    const toVal = samarkandPbxDateTo || todayISO();
    const res = await fetch(`/api/samarkand-pbx/sync?from=${encodeURIComponent(fromVal)}&to=${encodeURIComponent(toVal)}`, { method: 'POST' });
    const data = await res.json();
    if (res.status === 429 || data?.busy) {
      if (typeof toast === 'function') toast('warn', 'Samarqand OnlinePBX', data?.message || 'Sinxronlash allaqachon bajarilmoqda');
    } else if (data && data.ok) {
      const addedCount = data.saved_count !== undefined ? data.saved_count : (data.total_fetched || 0);
      if (typeof toast === 'function') toast('success', 'Samarqand OnlinePBX', `${addedCount} ta yangi qo'ng'iroq qo'shildi`);
    } else {
      const msg = data?.message || data?.error || 'Sinxronlashda xatolik yuz berdi';
      if (typeof toast === 'function') toast('warn', 'Samarqand OnlinePBX', msg);
    }
    await fetchAndRenderSamarkandPbxStats(false);
  } catch (err) {
    if (typeof toast === 'function') toast('error', 'Samarqand OnlinePBX', 'Serverga ulanish xatosi: ' + err.message);
    await fetchAndRenderSamarkandPbxStats(false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (typeof hydrateLucideIcons === 'function') hydrateLucideIcons(btn);
    }
  }
}

async function relinkSamarkandPbxCallsManual() {
  const btn = document.getElementById('samarkand_pbx_relink_btn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-icon spin" data-lucide="loader-2"></span><span>Biriktirilmoqda...</span>`;
    if (typeof hydrateLucideIcons === 'function') hydrateLucideIcons(btn);
  }
  try {
    const res = await fetch('/api/samarkand-pbx/relink', { method: 'POST' });
    const data = await res.json();
    if (data && data.ok) {
      const cnt = data.updated_count || 0;
      toast('success', 'Samarqand OnlinePBX', `${cnt} ta qo'ng'iroq xodimlarga qayta biriktirildi`);
    } else {
      toast('warn', 'Samarqand OnlinePBX', data?.error || 'Biriktirishda xatolik');
    }
    await fetchAndRenderSamarkandPbxStats(false);
  } catch (err) {
    toast('error', 'Samarqand OnlinePBX', err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (typeof hydrateLucideIcons === 'function') hydrateLucideIcons(btn);
    }
  }
}

function exportSamarkandPbxExcel() {
  const operators = samarkandPbxStatsCache?.operators || [];
  if (!operators.length) {
    toast('warn', 'Samarqand OnlinePBX', t('no_data') || 'Eksport uchun ma\'lumot yo\'q');
    return;
  }
  if (typeof XLSX === 'undefined') {
    toast('warn', 'Samarqand OnlinePBX', 'XLSX kutubxonasi mavjud emas');
    return;
  }

  const totalX = samarkandPbxStatsCache?.summary?.total_calls || 0;
  const accountsCount = Math.max(1, samarkandPbxStatsCache?.summary?.accounts_count || operators.length);
  const targetQuota = samarkandPbxStatsCache?.summary?.target_quota != null 
    ? samarkandPbxStatsCache.summary.target_quota 
    : (Math.round((totalX / accountsCount) * 10) / 10);

  const headers = [
    '#',
    'Operator',
    'Mas\'ul xodim',
    'Kiruvchi',
    'Har biriga norma',
    'Gaplashilgan (Y)',
    'Propushnniy',
    'Qabul foizi (Y/Z*100%)',
    'Jami suhbat vaqti',
    'O\'rtacha suhbat vaqti',
    'Qo\'yilgan baho'
  ];

  const rows = operators.map((op, i) => [
    i + 1,
    op.operator_number || '—',
    op.employee_name || '—',
    op.total_calls || 0,
    op.target_quota != null ? op.target_quota : targetQuota,
    op.answered_calls || 0,
    op.missed_calls || 0,
    `${op.answered_percent || 0}%`,
    fmtPbxSeconds(op.total_talk_seconds || 0),
    fmtPbxSeconds(op.avg_talk_seconds || 0),
    op.avg_rating ? `★ ${op.avg_rating} (${op.rated_calls_count || 0})` : '—'
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  const sheetName = `Samarkand_${samarkandPbxDateFrom}_${samarkandPbxDateTo}`.substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `AloqaPro_Samarkand_OnlinePBX_${samarkandPbxDateFrom}_${samarkandPbxDateTo}.xlsx`);
  toast('success', 'Samarqand OnlinePBX', 'Excel hisoboti yuklab olindi!');
}

function openSamarkandPbxWebhookModal() {
  const modal = document.getElementById('m_samarkand_pbx_webhook');
  if (!modal) return;
  const urlInp = document.getElementById('samarkand_pbx_webhook_url_display');
  if (urlInp) {
    urlInp.value = `${window.location.origin}/api/samarkand-pbx/webhook`;
  }
  modal.classList.remove('hidden');
}

function closeSamarkandPbxWebhookModal() {
  const modal = document.getElementById('m_samarkand_pbx_webhook');
  if (modal) modal.classList.add('hidden');
}

function copySamarkandPbxWebhookUrl() {
  const urlInp = document.getElementById('samarkand_pbx_webhook_url_display');
  if (!urlInp) return;
  navigator.clipboard.writeText(urlInp.value).then(() => {
    toast('success', 'Samarqand OnlinePBX Webhook', 'Webhook URL xotiraga nusxalandi!');
  }).catch(() => {});
}

function refreshSamarkandPbxStaticLabels() {
  const titleEl = document.getElementById('samarkand_pbx_header_title');
  if (titleEl) {
    titleEl.innerHTML = `<span data-lucide="phone-incoming" style="color:var(--accent);width:22px;height:22px;"></span> Samarqand OnlinePBX Qo'ng'iroqlar va Operatorlar nazorati`;
  }
}
