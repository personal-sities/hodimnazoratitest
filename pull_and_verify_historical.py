import urllib.request, urllib.parse, json, time, datetime, os

ROOT = os.path.dirname(os.path.abspath(__file__))

# 1. Token va domen olish (.env bo'lsa .env dan, bo'lmasa standart)
env_file = os.path.join(ROOT, '.env')
domain = 'pbx27644.onpbx.ru'
token = 'd3JUS3ZpNHVndlVWdXgwVXh4Wk8wR3QzSWpldjc0a1U'

if os.path.exists(env_file):
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('ONLINEPBX_DOMAIN='):
                domain = line.split('=', 1)[1].strip().strip('"').strip("'")
            elif line.startswith('ONLINEPBX_TOKEN='):
                token = line.split('=', 1)[1].strip().strip('"').strip("'")

print(f"OnlinePBX ga ulanmoqda: Domen={domain}...")
auth_url = f"https://api2.onlinepbx.ru/{domain}/auth.json"
data = urllib.parse.urlencode({'auth_key': token}).encode()

req = urllib.request.Request(auth_url, data=data)
res = json.loads(urllib.request.urlopen(req, timeout=15).read().decode())
key = res['data']['key']
key_id = res['data']['key_id']
headers = {'x-pbx-authentication': f"{key_id}:{key}"}
print("Muvaffaqiyatli avtorizatsiyadan o'tildi!")

# 2. Xodimlarni olish (operator_number -> employee_id, employee_name)
try:
    emp_res = json.loads(urllib.request.urlopen('https://workmeter.uz/api/employees', timeout=15).read().decode())
    employees = emp_res.get('data', [])
except Exception as e:
    print(f"Xodimlarni yuklashda ogohlantirish: {e}")
    employees = []

allowedSet = {'100', '101', '102', '103', '104', '105', '5002'}
empByOp = {}
for emp in employees:
    op = str(emp.get('operator_number') or '').strip()
    pbx = str(emp.get('pbx_extension') or '').strip()
    if op and op in allowedSet and op not in empByOp: empByOp[op] = emp
    if pbx and pbx in allowedSet and pbx not in empByOp: empByOp[pbx] = emp

DEFAULT_PBX_OPERATOR_NAMES = {
    '100': 'Qarshiyeva Durdona',
    '101': 'Ergashbayeva Donoxon',
    '102': 'Abdullayeva Shaxzoda',
    '103': 'Mamarajabova Mohinur',
    '104': "Zakirova Ra'no",
    '105': 'Ismatullayeva Parizod',
    '5002': '5002-operator'
}

# 3. 13.10.2026 dan 30.10.2026 gacha kunma-kun yuklash
start_date = datetime.date(2026, 10, 13)
end_date = datetime.date(2026, 10, 30)

cur = start_date
search_url = f"https://api2.onlinepbx.ru/{domain}/mongo_history/search.json"

all_prepared_calls = []
daily_stats_table = {}

print("\n" + "=" * 80)
print(f"{'Sana':<12} | {'Jami':<6} | {'Kiruvchi':<8} | {'Chiquvchi':<9} | {'Propushnniy':<11} | {'Gaplashilgan':<12}")
print("-" * 80)

while cur <= end_date:
    d_str = cur.strftime('%Y-%m-%d')
    # Toshkent UTC+5:
    dt_start = datetime.datetime(cur.year, cur.month, cur.day, 0, 0, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=5)))
    dt_end = datetime.datetime(cur.year, cur.month, cur.day, 23, 59, 59, tzinfo=datetime.timezone(datetime.timedelta(hours=5)))
    ts_from = int(dt_start.timestamp())
    ts_to = int(dt_end.timestamp())

    s_data = urllib.parse.urlencode({'start_stamp_from': str(ts_from), 'start_stamp_to': str(ts_to)}).encode()
    s_req = urllib.request.Request(search_url, data=s_data, headers=headers)
    raw_calls = json.loads(urllib.request.urlopen(s_req, timeout=40).read().decode()).get('data', [])

    day_incoming = 0
    day_outgoing = 0
    day_missed = 0
    day_answered = 0
    day_total_talk = 0

    # Kunlik operatorlar statistikasi
    op_day_map = {op: {
        'operator_number': op,
        'employee_name': DEFAULT_PBX_OPERATOR_NAMES.get(op, 'Operator'),
        'assigned_calls': 0,
        'answered_calls': 0,
        'missed_calls': 0,
        'total_talk_seconds': 0,
        'rated_calls_count': 0,
        'rating_sum': 0
    } for op in allowedSet}

    for raw in raw_calls:
        uuid = raw.get('uuid')
        if not uuid: continue
        startStamp = int(raw.get('start_stamp') or 0)
        if not startStamp: continue

        startedAt = datetime.datetime.fromtimestamp(startStamp, datetime.timezone.utc).isoformat().replace('+00:00', '.000Z')
        tashkentDate = datetime.datetime.fromtimestamp(startStamp + 5*3600, datetime.timezone.utc).strftime('%Y-%m-%d')

        duration = int(raw.get('duration') or 0)
        talkTime = int(raw.get('user_talk_time') or raw.get('billsec') or 0)
        isAnswered = (talkTime > 0)
        status = 'answered' if isAnswered else 'missed'

        caller = str(raw.get('caller_id_number') or raw.get('caller') or '').strip()
        callee = str(raw.get('destination_number') or raw.get('callee') or '').strip()

        # Operator raqamini aniqlash
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

        if direction == 'in':
            day_incoming += 1
            if isAnswered:
                day_answered += 1
                day_total_talk += talkTime
            else:
                day_missed += 1

            if operatorNumber and operatorNumber in op_day_map:
                op_day_map[operatorNumber]['assigned_calls'] += 1
                if isAnswered:
                    op_day_map[operatorNumber]['answered_calls'] += 1
                    op_day_map[operatorNumber]['total_talk_seconds'] += talkTime
                else:
                    op_day_map[operatorNumber]['missed_calls'] += 1
        else:
            day_outgoing += 1

        matchedEmp = empByOp.get(operatorNumber) if operatorNumber else None
        employeeId = matchedEmp['id'] if matchedEmp else None
        employeeName = matchedEmp['name'] if matchedEmp else DEFAULT_PBX_OPERATOR_NAMES.get(operatorNumber, None)

        rawScore = raw.get('quality_score') or raw.get('rating') or raw.get('score')
        rating = None
        if rawScore is not None and str(rawScore).strip():
            try:
                num = float(rawScore)
                if 1 <= num <= 5:
                    rating = round(num, 1)
                    if operatorNumber and operatorNumber in op_day_map and direction == 'in':
                        op_day_map[operatorNumber]['rating_sum'] += rating
                        op_day_map[operatorNumber]['rated_calls_count'] += 1
            except: pass

        all_prepared_calls.append({
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

    # Kunlik jadvalga chiqarish
    print(f"{d_str:<12} | {len(raw_calls):<6} | {day_incoming:<8} | {day_outgoing:<9} | {day_missed:<11} | {day_answered:<12}")

    # Kunlik statistika obyekti
    X = day_incoming
    Z = round(X / 5, 1) if X > 0 else 0
    op_list = []
    for op_num in ['100', '101', '102', '103', '104', '105', '5002']:
        it = op_day_map[op_num]
        is5002 = (op_num == '5002')
        ans = it['answered_calls']
        ans_pct = None if is5002 else (round((ans / Z) * 100, 1) if Z > 0 else 0)
        avg_talk = round(it['total_talk_seconds'] / ans) if ans > 0 else 0
        avg_rat = round(it['rating_sum'] / it['rated_calls_count'], 1) if it['rated_calls_count'] > 0 else None
        op_list.append({
            'operator_number': it['operator_number'],
            'employee_name': it['employee_name'],
            'total_calls': X,
            'assigned_calls': it['assigned_calls'],
            'answered_calls': ans,
            'missed_calls': it['missed_calls'],
            'target_quota': None if is5002 else Z,
            'answered_percent': ans_pct,
            'total_talk_seconds': it['total_talk_seconds'],
            'avg_talk_seconds': avg_talk,
            'avg_rating': avg_rat,
            'rated_calls_count': it['rated_calls_count']
        })
    op_list.sort(key=lambda x: (1 if x['operator_number'] == '5002' else 0, -x['answered_calls']))

    daily_stats_table[d_str] = {
        'total_calls': X,
        'incoming_calls': day_incoming,
        'outgoing_calls': day_outgoing,
        'all_calls_total': len(raw_calls),
        'accounts_count': 5,
        'target_quota': Z,
        'answered_calls': day_answered,
        'missed_calls': day_missed,
        'answered_percent': round((day_answered / X) * 100, 1) if X > 0 else 0,
        'total_talk_seconds': day_total_talk,
        'avg_talk_seconds': round(day_total_talk / day_answered) if day_answered > 0 else 0,
        'operators': op_list
    }

    cur += datetime.timedelta(days=1)
    time.sleep(0.1)

print("-" * 80)
print(f"Jami yuklangan tarixiy qo'ng'iroqlar soni: {len(all_prepared_calls)} ta")

# 4. KONTROL TEKSHIRUV (29.10.2026 uchun)
check_29 = daily_stats_table.get('2026-10-29')
if not check_29:
    print("XATOLIK: 2026-10-29 ma'lumoti topilmadi!")
    exit(1)

c_total = check_29['all_calls_total']
c_in = check_29['incoming_calls']
c_out = check_29['outgoing_calls']
c_missed = check_29['missed_calls']

print("\n" + "=" * 80)
print("KONTROL TEKSHIRUVI (29.10.2026):")
print(f"  Jami kutilgan:        1004  | Haqiqiy: {c_total}  -> {'MOS KELDI' if c_total == 1004 else 'XATO'}")
print(f"  Kiruvchi kutilgan:    798   | Haqiqiy: {c_in}   -> {'MOS KELDI' if c_in == 798 else 'XATO'}")
print(f"  Chiquvchi kutilgan:   206   | Haqiqiy: {c_out}   -> {'MOS KELDI' if c_out == 206 else 'XATO'}")
print(f"  Propushnniy kutilgan: 313   | Haqiqiy: {c_missed}   -> {'MOS KELDI' if c_missed == 313 else 'XATO'}")
print("=" * 80)

if c_total != 1004 or c_in != 798 or c_out != 206 or c_missed != 313:
    print("XATO: 29.10.2026 kontrol raqamlari mos kelmadi! To'xtatildi.")
    exit(1)

# 5. data/pbx_historical_stats.json ga saqlash
data_dir = os.path.join(ROOT, 'data')
os.makedirs(data_dir, exist_ok=True)
stats_json_path = os.path.join(data_dir, 'pbx_historical_stats.json')

with open(stats_json_path, 'w', encoding='utf-8') as f:
    json.dump({
        'period': {'from': '2026-10-13', 'to': '2026-10-30'},
        'daily': daily_stats_table
    }, f, ensure_ascii=False, indent=2)

print(f"\n[1] data/pbx_historical_stats.json ga muvaffaqiyatli saqlandi!")

# 6. assets/js/app-parts/06-pbx-preloaded-data.js ga saqlash
preloaded_js_path = os.path.join(ROOT, 'assets', 'js', 'app-parts', '06-pbx-preloaded-data.js')

js_content = f'''// ============================================================
//  ONLINEPBX HISTORICAL DATA (13.10.2026 - 30.10.2026)
// ============================================================
window.PBX_HISTORICAL_STATS = {json.dumps(daily_stats_table, ensure_ascii=False, indent=2)};

window.PBX_PRELOADED_CALLS = [];
'''

with open(preloaded_js_path, 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f"[2] assets/js/app-parts/06-pbx-preloaded-data.js ga muvaffaqiyatli saqlandi! ({len(all_prepared_calls)} ta qo'ng'iroq)")

# 7. data/calls.json faylini ham yangilaymiz
calls_json_path = os.path.join(data_dir, 'calls.json')
try:
    existing_calls = []
    if os.path.exists(calls_json_path):
        with open(calls_json_path, 'r', encoding='utf-8') as f:
            existing_calls = json.load(f)
    existing_ids = {c.get('call_id') for c in existing_calls if c.get('call_id')}
    added = 0
    for c in all_prepared_calls:
        if c.get('call_id') not in existing_ids:
            existing_calls.append(c)
            existing_ids.add(c.get('call_id'))
            added += 1
    with open(calls_json_path, 'w', encoding='utf-8') as f:
        json.dump(existing_calls, f, ensure_ascii=False, indent=2)
    print(f"[3] data/calls.json ga {added} ta yangi qo'ng'iroq qo'shildi (Jami: {len(existing_calls)} ta)")
except Exception as e:
    print(f"data/calls.json yangilash xatosi: {e}")

# 8. workmeter.uz ga bugungi qo'ng'iroqlarni yuklash
today_calls = [c for c in all_prepared_calls if c.get('call_date') == '2026-10-30']
print(f"\n[4] workmeter.uz ga bugungi ({len(today_calls)} ta) qo'ng'iroqlar saqlanmoqda...")
saved = 0
BATCH = 30
for i in range(0, len(today_calls), BATCH):
    chunk = today_calls[i:i+BATCH]
    try:
        post_req = urllib.request.Request(
            'https://workmeter.uz/api/db/calls?on_conflict=call_id',
            data=json.dumps(chunk).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(post_req, timeout=20) as p_resp:
            r_data = json.loads(p_resp.read().decode())
            if r_data.get('ok'):
                saved += len(chunk)
    except Exception as err:
        pass
print(f"    workmeter.uz ga jami {saved} ta qo'ng'iroq saqlandi.")
