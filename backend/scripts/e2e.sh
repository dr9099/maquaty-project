#!/usr/bin/env bash
# اختبار تكامل سريع (e2e) — المرحلتان 1 و2: يتطلب خادماً يعمل + قاعدة بيانات مهيأة
# الاستخدام: bash scripts/e2e.sh [baseUrl]  (نفّذ scripts/db-reset.sh أولاً لتشغيل نظيف)
set -e
BASE="${1:-http://localhost:3000}"
PASS=0; FAIL=0
T=".e2e-tmp"; mkdir -p "$T"

check() { # check "الوصف" "المتوقع" "الفعلي"
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "✅ $1"
  else FAIL=$((FAIL+1)); echo "❌ $1 — المتوقع [$2] الفعلي [$3]"; head -c 160 "$T/last.json" 2>/dev/null; echo ""; fi
}

jsonget() { # jsonget "ملف.json" "مسار.نقطي"
  cp "$T/$1" "$T/last.json" 2>/dev/null
  node -e "
    const j = JSON.parse(require('fs').readFileSync('$T/$1','utf8'));
    const v = '$2'.split('.').reduce((o,k)=>o?.[k], j);
    console.log(v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
  "
}
jbool() { node -e "const j=JSON.parse(require('fs').readFileSync('$T/$1','utf8'));console.log($2)"; }

post() { curl -s -X POST "$BASE$1" -H "Content-Type: application/json" ${3:+-H "Authorization: Bearer $3"} -d "$2" -o "$T/$4"; }
patch(){ curl -s -X PATCH "$BASE$1" -H "Content-Type: application/json" -H "Authorization: Bearer $2" -d "$3" -o "$T/$4"; }
del()  { curl -s -X DELETE "$BASE$1" -H "Authorization: Bearer $2" -o "$T/$3"; }
get()  { curl -s "$BASE$1" -H "Authorization: Bearer $2" -o "$T/$3"; }

# ═══ المرحلة 1: المصادقة ═══
post /v1/auth/register-store-owner '{"fullName":"محمد أحمد","storeName":"مقوت الصباحي","phone":"777123456","password":"Passw0rd!","passwordConfirmation":"Passw0rd!","deviceFingerprint":"DEV-001"}' "" reg.json
check "تسجيل مالك جديد — حالة TRIAL" "TRIAL" "$(jsonget reg.json account.status)"

post /v1/auth/register-store-owner '{"fullName":"مكرر","storeName":"مكرر","phone":"777123456","password":"Passw0rd!","passwordConfirmation":"Passw0rd!","deviceFingerprint":"DEV-002"}' "" dup.json
check "رقم مكرر 409" "PHONE_ALREADY_EXISTS" "$(jsonget dup.json error.code)"

post /v1/auth/login '{"phone":"777123456","password":"خطأ","deviceFingerprint":"DEV-001"}' "" badlogin.json
check "دخول خاطئ 401" "INVALID_CREDENTIALS" "$(jsonget badlogin.json error.code)"

post /v1/auth/login '{"phone":"777123456","password":"Passw0rd!","deviceFingerprint":"DEV-001"}' "" login.json
check "دخول ناجح — TRIAL" "TRIAL" "$(jsonget login.json account_status)"

OWNER=$(jsonget login.json access_token)
REFRESH=$(jsonget login.json refresh_token)

post /v1/auth/refresh "{\"refreshToken\":\"$REFRESH\"}" "" refresh.json
check "تدوير refresh_token" "true" "$(jbool refresh.json '!!j.access_token')"
post /v1/auth/refresh "{\"refreshToken\":\"$REFRESH\"}" "" replay.json
check "إعادة استخدام توكن مدوَّر مرفوضة" "INVALID_REFRESH_TOKEN" "$(jsonget replay.json error.code)"

# ═══ المرحلة 2: الأصناف والمحافظ والبيع ═══
post /v1/items "{\"name\":\"شامي\",\"unit\":\"كيلو\",\"quantity\":10,\"costPrice\":2500,\"sellPrice\":3000,\"emergencyPriceMode\":\"COST_PLUS\",\"emergencyPricePlusFixed\":200}" "$OWNER" item.json
check "إنشاء صنف (معرّف موجود)" "true" "$(jbool item.json '!!j.item?.id')"

post /v1/items '{"name":"شامي","unit":"كيلو","quantity":5,"costPrice":2500,"sellPrice":3000}' "$OWNER" merge.json
check "توريد نفس الصنف يُجمع (BR-003)" "true" "$(jsonget merge.json merged)"
check "الكمية مجمعة 15" "15" "$(jsonget merge.json item.quantity)"

post /v1/wallets '{"name":"كريمي"}' "$OWNER" wallet.json
WALLET=$(jsonget wallet.json id)
check "إنشاء محفظة (معرّف موجود)" "true" "$(jbool wallet.json '!!j.id')"

ITEM=$(jsonget item.json item.id)

# بيع نقدي: 2 × 3000 = 6000
post /v1/sales "{\"itemId\":\"$ITEM\",\"quantity\":2,\"amount\":6000,\"paymentType\":\"CASH\"}" "$OWNER" sale1.json
check "بيع نقدي" "CASH" "$(jsonget sale1.json sale.payment_type)"
check "العداد زاد والباقي ≥ 30" "TRIAL" "$(jsonget sale1.json account_status)"

post /v1/sales "{\"itemId\":\"$ITEM\",\"quantity\":1,\"amount\":9999,\"paymentType\":\"CASH\"}" "$OWNER" badamt.json
check "مبلغ لا يطابق السعر 400" "VALIDATION_ERROR" "$(jsonget badamt.json error.code)"

# اضطراري دون الهامش (2500+200=2700 أدنى)
post /v1/sales "{\"itemId\":\"$ITEM\",\"quantity\":1,\"amount\":2500,\"paymentType\":\"CASH\",\"isEmergencySale\":true,\"emergencyOverridePrice\":2500,\"emergencyReason\":\"عمل جملة\"}" "$OWNER" emerg.json
check "اضطراري دون الهامش 400" "EMERGENCY_PRICE_BELOW_MINIMUM" "$(jsonget emerg.json error.code)"

# اضطراري سليم: 2 × 2750 = 5500 — خسارة (3000-2750)×2 = 500
post /v1/sales "{\"itemId\":\"$ITEM\",\"quantity\":2,\"amount\":5500,\"paymentType\":\"CASH\",\"isEmergencySale\":true,\"emergencyOverridePrice\":2750,\"emergencyReason\":\"عمل جملة\"}" "$OWNER" emerg2.json
check "اضطراري ضمن السياسة" "true" "$(jsonget emerg2.json sale.is_emergency_sale)"
check "خسارة الفرق 500 (R-16)" "500" "$(jsonget emerg2.json sale.price_difference_loss)"

# إلكتروني بدون مرفق
post /v1/sales "{\"itemId\":\"$ITEM\",\"quantity\":1,\"amount\":3000,\"paymentType\":\"ELECTRONIC\",\"walletId\":\"$WALLET\"}" "$OWNER" nodep.json
check "إلكتروني بدون مرفق 400" "MISSING_DEPOSIT_ATTACHMENT" "$(jsonget nodep.json error.code)"

# إلكتروني كامل
post /v1/sales "{\"itemId\":\"$ITEM\",\"quantity\":1,\"amount\":3000,\"paymentType\":\"ELECTRONIC\",\"walletId\":\"$WALLET\",\"depositAttachmentUrl\":\"https://files.test/dep.jpg\"}" "$OWNER" elec.json
check "بيع إلكتروني" "ELECTRONIC" "$(jsonget elec.json sale.payment_type)"

# تجاوز المخزون (المتبقي 10)
post /v1/sales "{\"itemId\":\"$ITEM\",\"quantity\":99,\"amount\":297000,\"paymentType\":\"CASH\"}" "$OWNER" over.json
check "تجاوز المخزون 409" "INSUFFICIENT_STOCK" "$(jsonget over.json error.code)"

get "/v1/inventory" "$OWNER" inv.json
check "المخزون يعكس الخصم 10" "10" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$T/inv.json','utf8'));console.log(j[0].remaining_qty)")"
check "المالك يرى قيمة المتبقي" "true" "$(jbool inv.json "j[0].remaining_value!==undefined")"

get "/v1/sales/summary-by-item" "$OWNER" summary.json
check "المباع: إجمالي 14500" "14500" "$(jsonget summary.json total)"
get "/v1/sales/log" "$OWNER" log.json
check "سجل العمليات: 3 عمليات" "3" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$T/log.json','utf8'));console.log(j.operations.length)")"
check "شارة بيع اضطراري في السجل" "true" "$(jbool log.json "j.operations.some(o=>o.is_emergency_sale)")"
check "إجمالي النقد بالسجل 11500" "11500" "$(jsonget log.json totals.cash)"


# ═══ المرحلة 3: العمال والصلاحيات (R-33/R-11/RBAC) ═══
post /v1/workers '{"fullName":"أمين صالح","phone":"222111777","password":"Passw0rd!","passwordConfirmation":"Passw0rd!","isResponsible":true}' "$OWNER" w1.json
check "إنشاء عامل مسؤول دون رصيد (R-33)" "true" "$(jbool w1.json 'j.is_responsible===true')"
W1=$(jsonget w1.json id)

post /v1/workers '{"fullName":"سالم","phone":"333222111","password":"Passw0rd!","passwordConfirmation":"Passw0rd!"}' "$OWNER" w2fail.json
check "عامل عادي بلا رصيد 403" "WORKER_LIMIT_REACHED" "$(jsonget w2fail.json error.code)"

node --env-file=.env -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.storeOwner.update({where:{phone:'777123456'},data:{maxWorkersAllowed:1}}).then(()=>{process.exit(0)}).catch(()=>{process.exit(1)});" > /dev/null
post /v1/workers '{"fullName":"سالم","phone":"333222111","password":"Passw0rd!","passwordConfirmation":"Passw0rd!"}' "$OWNER" w2.json
check "إنشاء عامل عادي بعد منح الرصيد" "true" "$(jbool w2.json '!!j.id')"
W2=$(jsonget w2.json id)

post /v1/workers '{"fullName":"رابع","phone":"444333222","password":"Passw0rd!","passwordConfirmation":"Passw0rd!"}' "$OWNER" w3fail.json
check "تجاوز الرصيد 403" "WORKER_LIMIT_REACHED" "$(jsonget w3fail.json error.code)"

post /v1/workers '{"fullName":"مكرر","phone":"777123456","password":"Passw0rd!","passwordConfirmation":"Passw0rd!"}' "$OWNER" wdup.json
check "هاتف مكرر عالمياً 409 (BR-032)" "PHONE_ALREADY_EXISTS" "$(jsonget wdup.json error.code)"

post /v1/auth/login '{"phone":"333222111","password":"Passw0rd!","deviceFingerprint":"DEV-W2"}' "" w2login.json
W2TOKEN=$(jsonget w2login.json access_token)
check "دخول عامل عادي" "WORKER" "$(jsonget w2login.json role)"

get /v1/inventory "$W2TOKEN" winv.json
check "عامل: لا remaining_value افتراضياً" "true" "$(jbool winv.json 'j[0].remaining_value===undefined')"
check "عامل: لا cost_price أبداً" "true" "$(jbool winv.json 'j[0].cost_price===undefined')"

get /v1/workers "$W2TOKEN" wforbidden.json
check "عامل لا يصل لإدارة العمال 403" "PERMISSION_DENIED" "$(jsonget wforbidden.json error.code)"

CREDITBODY=$(printf '{"itemId":"%s","quantity":1,"amount":3000,"paymentType":"CREDIT","creditCustomerId":"00000000-0000-0000-0000-000000000000"}' "$ITEM")
post /v1/sales "$CREDITBODY" "$W2TOKEN" wcredit.json
check "عامل عادي لا يبيع آجلاً 403 (BR-009)" "PERMISSION_DENIED" "$(jsonget wcredit.json error.code)"

post /v1/auth/login '{"phone":"222111777","password":"Passw0rd!","deviceFingerprint":"DEV-W1"}' "" w1login.json
W1TOKEN=$(jsonget w1login.json access_token)
get /v1/managed-workers "$W1TOKEN" mw.json
check "المسؤول يرى العمال المدارين" "true" "$(jbool mw.json 'Array.isArray(j)&&j.length>=2')"
get "/v1/managed-workers/$W2/sales-summary" "$W1TOKEN" mws.json
check "ملخص مبيعات عامل (اطلاع فقط)" "true" "$(jbool mws.json 'j.total!==undefined')"
get /v1/managed-workers "$W2TOKEN" mw403.json
check "عامل عادي لا يرى المدارين 403" "PERMISSION_DENIED" "$(jsonget mw403.json error.code)"

post /v1/workers/$W2/promote-responsible '{}' "$OWNER" promo409.json
check "ترقية مع مسؤول قائم بلا تأكيد 409" "RESPONSIBLE_WORKER_EXISTS" "$(jsonget promo409.json error.code)"
post /v1/workers/$W2/promote-responsible '{"confirmReplace":true}' "$OWNER" promo.json
check "نقل الصفة ذرّياً بالتأكيد" "true" "$(jbool promo.json 'j.is_responsible===true')"
get /v1/managed-workers "$W1TOKEN" mwold.json
check "سحب الصفة فوري حتى بتوكن قديم (BR-070)" "PERMISSION_DENIED" "$(jsonget mwold.json error.code)"
post /v1/workers/$W2/demote-responsible '{}' "$OWNER" demote.json
check "تنزيل المسؤول" "true" "$(jbool demote.json 'j.is_responsible===false')"

patch /v1/workers/$W2/suspend '{"suspended":true}' "$OWNER" susp.json
post /v1/auth/login '{"phone":"333222111","password":"Passw0rd!","deviceFingerprint":"DEV-W2"}' "" susplogin.json
check "موقوف لا يدخل — reason صحيح" "WORKER_SUSPENDED" "$(jsonget susplogin.json error.details.reason)"
get /v1/inventory "$W2TOKEN" oldtoken.json
check "توكن الموقوف مرفوض فوراً (423)" "ACCOUNT_LOCKED" "$(jsonget oldtoken.json error.code)"
patch /v1/workers/$W2/suspend '{"suspended":false}' "$OWNER" unsusp.json
post /v1/auth/login '{"phone":"333222111","password":"Passw0rd!","deviceFingerprint":"DEV-W2"}' "" w2login2.json
check "إلغاء الإيقاف يعيد الدخول" "WORKER" "$(jsonget w2login2.json role)"

node --env-file=.env -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.storeOwner.update({where:{phone:'777123456'},data:{maxWorkersAllowed:2}}).then(()=>{process.exit(0)}).catch(()=>{process.exit(1)});" > /dev/null
del /v1/workers/$W2 "$OWNER" wdel.json
check "حذف عامل (Soft)" "true" "$(jsonget wdel.json deleted)"
post /v1/workers '{"fullName":"بديل بعد حذف","phone":"666555444","password":"Passw0rd!","passwordConfirmation":"Passw0rd!"}' "$OWNER" wnew.json
check "الحذف يفتح مكاناً للرصيد (R-33)" "true" "$(jbool wnew.json '!!j.id')"
WNEW=$(jsonget wnew.json id)
patch /v1/workers/$WNEW '{"permissions":{"showSellPricesInventory":true}}' "$OWNER" wperm.json
post /v1/auth/login '{"phone":"666555444","password":"Passw0rd!","deviceFingerprint":"DEV-W3"}' "" w3login.json
W3TOKEN=$(jsonget w3login.json access_token)
get /v1/inventory "$W3TOKEN" w3inv.json
check "بعد تفعيل الصلاحية: يرى قيمة المتبقي" "true" "$(jbool w3inv.json 'j[0].remaining_value!==undefined')"
get /v1/workers "$OWNER" wlist.json
check "قائمة العمال تشمل الصلاحيات" "true" "$(jbool wlist.json 'j.every(w=>w.permissions!==undefined)')"

# ═══ القيود المحاسبية: توازن كل قيد (BR-054) ═══
node --env-file=.env -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT reference_id FROM ledger_entries GROUP BY reference_id HAVING SUM(debit) <> SUM(credit)\`
  .then((bad) => { console.log(bad.length === 0 ? '0' : String(bad.length)); return p.\$disconnect(); })
  .catch((e) => { console.error(e.message); process.exit(1); });
" > "$T/balance.txt"
check "كل القيود متوازنة (مدين=دائن)" "0" "$(cat "$T/balance.txt")"

echo ""
echo "════════════════════════════"
echo "النتيجة: $PASS ناجح، $FAIL فاشل"
if [ "$FAIL" -gt 0 ]; then echo "(ملفات الفشل في $T)"; else rm -rf "$T"; fi
exit $FAIL
