#!/usr/bin/env bash
# اختبار تكامل سريع (e2e) — المرحلتان 1 و2: يتطلب خادماً يعمل + قاعدة بيانات مهيأة
# الاستخدام: bash scripts/e2e.sh [baseUrl]  (نفّذ scripts/db-reset.sh أولاً لتشغيل نظيف)
set -e
BASE="${1:-http://localhost:3000}"
PASS=0; FAIL=0
T=".e2e-tmp"; mkdir -p "$T"

check() { # check "الوصف" "المتوقع" "الفعلي"
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "✅ $1"
  else FAIL=$((FAIL+1)); echo "❌ $1 — المتوقع [$2] الفعلي [$3]"; fi
}

jsonget() { # jsonget "ملف.json" "مسار.نقطي"
  node -e "
    const j = JSON.parse(require('fs').readFileSync('$T/$1','utf8'));
    const v = '$2'.split('.').reduce((o,k)=>o?.[k], j);
    console.log(v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
  "
}
jbool() { node -e "const j=JSON.parse(require('fs').readFileSync('$T/$1','utf8'));console.log($2)"; }

post() { curl -s -X POST "$BASE$1" -H "Content-Type: application/json" ${3:+-H "Authorization: Bearer $3"} -d "$2" -o "$T/$4"; }
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
rm -rf "$T"
exit $FAIL
