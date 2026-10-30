import urllib.request, urllib.parse, json, time, datetime, sys

domain = 'pbx27644.onpbx.ru'
token = 'd3JUS3ZpNHVndlVWdXgwVXh4Wk8wR3QzSWpldjc0a1U'

print('[1/4] OnlinePBX avtorizatsiyadan o\'tilmoqda...')
auth_url = f'https://api2.onlinepbx.ru/{domain}/auth.json'
data = urllib.parse.urlencode({'auth_key': token}).encode()

key = None
key_id = None
for attempt in range(3):
    try:
        req = urllib.request.Request(auth_url, data=data)
        with urllib.request.urlopen(req, timeout=30) as resp:
            res = json.loads(resp.read().decode())
            if res.get('status') == '1' or res.get('status') == 1:
                key = res['data']['key']
                key_id = res['data']['key_id']
                print('   OnlinePBX ga muvaffaqiyatli ulandi!')
                break
    except Exception as e:
        print(f'   Ulanish urinishi {attempt+1} xatosi: {e}')
        time.sleep(2)

if not key or not key_id:
    print('OnlinePBX avtorizatsiya bo\'lmadi!')
    sys.exit(1)

# Bugungi kun boshlanishi: 2026-10-30 00:00:00 Toshkent (UTC+5) = 2026-10-29 19:00:00 UTC = 1793300400
# 1793290000 dan boshlab olamiz (kechagi kechqurun va bugun to'liq)
t_start = 1793290000
t_now = int(time.time())

print(f'[2/4] OnlinePBX dan qo\'ng\'iroqlar yuklanmoqda ({t_start} dan {t_now} gacha)...')
search_url = f'https://api2.onlinepbx.ru/{domain}/mongo_history/search.json'
s_data = urllib.parse.urlencode({'start_stamp_from': str(t_start), 'start_stamp_to': str(t_now)}).encode()
s_req = urllib.request.Request(search_url, data=s_data, headers={'x-pbx-authentication': f'{key_id}:{key}'})

with urllib.request.urlopen(s_req, timeout=40) as resp:
    rawCalls = json.loads(resp.read().decode()).get('data', [])

print(f'   Jami {len(rawCalls)} ta qo\'ng\'iroq qabul qilindi.')

allowedSet = {'100', '101', '102', '103', '104', '105', '5002'}

# Xodimlarni workmeter.uz dan olish
try:
    emp_res = json.loads(urllib.request.urlopen('https://workmeter.uz/api/employees', timeout=15).read())
    employees = emp_res.get('data', [])
except Exception as e:
    print(f'   Xodimlarni yuklash xatosi: {e}')
    employees = []

empByOp = {}
for emp in employees:
    op = str(emp.get('operator_number') or '').strip()
    pbx = str(emp.get('pbx_extension') or '').strip()
    if op and op in allowedSet and op not in empByOp: empByOp[op] = emp
    if pbx and pbx in allowedSet and pbx not in empByOp: empByOp[pbx] = emp

prepared = []
for raw in rawCalls:
    uuid = raw.get('uuid')
    if not uuid: continue
    startStamp = int(raw.get('start_stamp') or 0)
    if not startStamp: continue

    startedAt = datetime.datetime.fromtimestamp(startStamp, datetime.timezone.utc).isoformat().replace('+00:00', '.000Z')
    tashkentDate = datetime.datetime.fromtimestamp(startStamp + 5*3600, datetime.timezone.utc).strftime('%Y-%m-%d')

    duration = int(raw.get('duration') or 0)
    talkTime = int(raw.get('user_talk_time') or raw.get('billsec') or 0)
    hangupCause = str(raw.get('hangup_cause') or '').upper()
    isAnswered = (hangupCause == 'NORMAL_CLEARING' and talkTime > 0) or (raw.get('contacted') == True and talkTime > 0) or (talkTime > 0)
    status = 'answered' if isAnswered else 'missed'
    caller = str(raw.get('caller_id_number') or raw.get('caller') or '').strip()
    callee = str(raw.get('destination_number') or raw.get('callee') or '').strip()

    operatorNumber = None
    if isinstance(raw.get('events'), list):
        for ev in raw['events']:
            num = str(ev.get('number') or ev.get('user') or '').strip()
            if ev.get('answered_stamp') and num in allowedSet:
                operatorNumber = num
                break
    if not operatorNumber and callee in allowedSet: operatorNumber = callee
    if not operatorNumber and caller in allowedSet: operatorNumber = caller
    if not operatorNumber and isinstance(raw.get('events'), list):
        for ev in raw['events']:
            num = str(ev.get('number') or ev.get('user') or '').strip()
            if num in allowedSet:
                operatorNumber = num
                break
    if not operatorNumber and raw.get('user') and str(raw.get('user')).strip() in allowedSet:
        operatorNumber = str(raw.get('user')).strip()

    direction = 'in'
    acct = str(raw.get('accountcode') or '').lower()
    if 'out' in acct or (operatorNumber and caller == operatorNumber):
        direction = 'out'

    matchedEmp = empByOp.get(operatorNumber) if operatorNumber else None
    employeeId = matchedEmp['id'] if matchedEmp else None
    employeeName = matchedEmp['name'] if matchedEmp else ('5002-operator' if operatorNumber == '5002' else None)

    rawScore = raw.get('quality_score') or raw.get('rating') or raw.get('score')
    rating = None
    if rawScore is not None and str(rawScore).strip():
        try:
            num = float(rawScore)
            if 1 <= num <= 5: rating = round(num, 1)
        except: pass

    prepared.append({
        'call_id': uuid,
        'caller': caller,
        'callee': callee,
        'operator_number': operatorNumber,
        'employee_id': employeeId,
        'employee_name': employeeName,
        'direction': direction,
        'status': status,
        'duration': duration,
        'talk_time': talkTime,
        'rating': rating,
        'call_date': tashkentDate,
        'started_at': startedAt,
        'raw_data': raw
    })

todayCalls = [c for c in prepared if c['call_date'] == '2026-10-30']
print(f'[3/4] Qayta ishlangan qo\'ng\'iroqlar: {len(prepared)} ta, shundan bugun (30.10.2026): {len(todayCalls)} ta')

# 3. Serverga (workmeter.uz) yuborish
print('[4/4] Serverga (workmeter.uz) saqlanmoqda...')
BATCH = 30
saved = 0
for i in range(0, len(prepared), BATCH):
    chunk = prepared[i:i+BATCH]
    post_req = urllib.request.Request(
        'https://workmeter.uz/api/db/calls?on_conflict=call_id',
        data=json.dumps(chunk).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(post_req, timeout=20) as p_resp:
            r_data = json.loads(p_resp.read().decode())
            if r_data.get('ok'):
                saved += len(chunk)
    except Exception as err:
        print(f'   Batch {i} xatosi: {err}')

print(f'   workmeter.uz ga jami {saved} ta qo\'ng\'iroq muvaffaqiyatli saqlandi!')

# 4. Lokal data/calls.json va preloaded data faylini ham yangilaymiz
try:
    import os
    local_calls_path = os.path.join(os.path.dirname(__file__), 'data', 'calls.json')
    if os.path.exists(local_calls_path):
        with open(local_calls_path, 'r', encoding='utf-8') as f:
            local_calls = json.load(f)
        
        # Yangi qo'ng'iroqlarni qo'shamiz (dublikatlarsiz)
        existing_ids = {c.get('call_id') for c in local_calls if c.get('call_id')}
        added = 0
        for p in prepared:
            if p['call_id'] not in existing_ids:
                local_calls.append(p)
                existing_ids.add(p['call_id'])
                added += 1
        
        with open(local_calls_path, 'w', encoding='utf-8') as f:
            json.dump(local_calls, f, ensure_ascii=False, indent=2)
        print(f'   Lokal data/calls.json ga {added} ta yangi qo\'ng\'iroq qo\'shildi.')
except Exception as e:
    print(f'   Lokal calls.json yangilash xatosi: {e}')
