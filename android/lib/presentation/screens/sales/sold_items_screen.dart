import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/utils/quantity_formatter.dart';
import '../../providers/sales_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة المباع لليوم المحدد — الشاشة 7 (SOLD_ITEMS / 07-sold-items.jpg)
class SoldItemsScreen extends StatefulWidget {
  const SoldItemsScreen({super.key});

  @override
  State<SoldItemsScreen> createState() => _SoldItemsScreenState();
}

class _SoldItemsScreenState extends State<SoldItemsScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SalesProvider>().fetchTodaySales();
    });
  }

  @override
  Widget build(BuildContext context) {
    final salesProvider = context.watch<SalesProvider>();
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;
    final sales = salesProvider.todaySales;

    // تجميع المباع لكل صنف
    final Map<String, _ItemSoldSummary> grouped = {};
    double totalAmount = 0.0;
    double totalQuantity = 0.0;

    for (var s in sales.where((x) => x.type == 'SALE')) {
      totalAmount += s.amount;
      totalQuantity += s.quantity;
      if (!grouped.containsKey(s.itemName)) {
        grouped[s.itemName] = _ItemSoldSummary(itemName: s.itemName, unit: s.unit);
      }
      grouped[s.itemName]!.totalQuantity += s.quantity;
      grouped[s.itemName]!.totalAmount += s.amount;
      grouped[s.itemName]!.operationsCount += 1;
    }

    final list = grouped.values.toList();

    return AppScaffold(
      title: 'المباع اليوم',
      currentBottomNavIndex: 2,
      body: Column(
        children: [
          // بطاقة الإجمالي الكلي للمبيعات اليوم
          Container(
            margin: const EdgeInsets.all(14),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('إجمالي كمية المباع', style: TextStyle(color: AppColors.surfaceMuted, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(
                      '$totalQuantity كجم/حبة',
                      style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('إجمالي القيمة المالية', style: TextStyle(color: AppColors.surfaceMuted, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(
                      '${_currencyFormat.format(totalAmount)} $symbol',
                      style: const TextStyle(color: AppColors.secondary, fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // قائمة الأصناف المباعة
          Expanded(
            child: salesProvider.isLoading
                ? const Center(child: CircularProgressIndicator())
                : list.isEmpty
                    ? const Center(
                        child: Text(
                          'لا توجد عمليات بيع مسجلة لهذا اليوم',
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: () => context.read<SalesProvider>().fetchTodaySales(),
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                          itemCount: list.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final item = list[index];
                            return Card(
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: AppColors.secondary.withOpacity(0.2),
                                  child: const Icon(Icons.shopping_bag_outlined, color: AppColors.primary),
                                ),
                                title: Text(item.itemName, style: const TextStyle(fontWeight: FontWeight.bold)),
                                subtitle: Text('عدد العمليات: ${item.operationsCount}'),
                                trailing: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      '${_currencyFormat.format(item.totalAmount)} $symbol',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                    Text(
                                      formatQuantityDisplay(item.totalQuantity, unit: item.unit),
                                      style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

class _ItemSoldSummary {
  final String itemName;
  final String? unit;
  double totalQuantity = 0.0;
  double totalAmount = 0.0;
  int operationsCount = 0;

  _ItemSoldSummary({required this.itemName, this.unit});
}
