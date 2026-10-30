const Set<String> _kiloUnits = {
  'كيلو',
  'كجم',
  'كيلوغرام',
  'كيلوجرام',
  'kg',
  'kilo',
  'kilogram',
};

const Set<String> _gramUnits = {
  'جرام',
  'جم',
  'غم',
  'غ',
  'g',
  'gram',
  'grams',
};

bool isKiloUnit(String? unit) {
  if (unit == null) return false;
  final n = unit.trim().toLowerCase();
  if (n.isEmpty) return false;
  if (_kiloUnits.contains(n)) return true;
  return n.contains('كيلو');
}

bool isGramUnit(String? unit) {
  if (unit == null) return false;
  final n = unit.trim().toLowerCase();
  return _gramUnits.contains(n);
}

bool isWeightUnit(String? unit) {
  if (unit == null) return false;
  final n = unit.trim().toLowerCase();
  return isKiloUnit(n) || isGramUnit(n);
}

/// تنسيق عرض كمية الوزن بصيغة عربية مفهومة:
/// - "220 جم"، "1 كجم"، "1 كجم و100 جم" بدلاً من "0.220 كيلو" أو "1.1 كيلو".
/// - إذا كانت الوحدة الأساسية هي الجرام بالفعل: تُعرض كما هي دون قسمة أو ضرب (مثل: "220 جرام").
/// - للوحدات العددية المنفصلة (حبة، ربطة): تُعرض كما هي مع اسم الوحدة (مثل: "3 حبة").
String formatQuantityDisplay(dynamic quantity, {String? unit}) {
  if (quantity == null) return '';

  double numVal;
  if (quantity is num) {
    numVal = quantity.toDouble();
  } else if (quantity is String) {
    numVal = double.tryParse(quantity) ?? 0.0;
  } else {
    numVal = 0.0;
  }

  final cleanUnit = (unit ?? 'كيلو').trim();
  final isNegative = numVal < 0;
  final absVal = numVal.abs();
  final prefix = isNegative ? '-' : '';

  // 1. إذا كانت الوحدة الأساسية جرام بالفعل
  if (isGramUnit(cleanUnit)) {
    final formatted = absVal % 1 == 0
        ? absVal.toInt().toString()
        : absVal.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
    return cleanUnit.isNotEmpty ? '$prefix$formatted $cleanUnit' : '$prefix$formatted';
  }

  // 2. إذا كانت الوحدة بالكيلو (أو فارغة)
  if (isKiloUnit(cleanUnit) || cleanUnit.isEmpty) {
    final totalGrams = (absVal * 1000).round();
    if (totalGrams == 0) return '0 جم';
    if (totalGrams < 1000) return '$prefix$totalGrams جم';

    final kg = totalGrams ~/ 1000;
    final remGrams = totalGrams % 1000;
    if (remGrams == 0) return '$prefix$kg كجم';
    return '$prefix$kg كجم و$remGrams جم';
  }

  // 3. أي وحدة عددية أو منفصلة أخرى
  final formatted = absVal % 1 == 0
      ? absVal.toInt().toString()
      : absVal.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
  return cleanUnit.isNotEmpty ? '$prefix$formatted $cleanUnit' : '$prefix$formatted';
}
