import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة المخزون — الشاشة 6 (INVENTORY / 06-inventory.jpg)
class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<InventoryProvider>().fetchInventory();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final inventory = context.watch<InventoryProvider>();
    final auth = context.watch<AuthProvider>();
    final items = inventory.items;

    return AppScaffold(
      title: 'المخزون',
      currentBottomNavIndex: 1,
      floatingActionButton: auth.canManagePurchases
          ? FloatingActionButton(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              child: const Icon(Icons.add),
              onPressed: () => Navigator.pushNamed(context, '/items-manage'),
            )
          : null,
      body: Column(
        children: [
          // شريط البحث
          Padding(
            padding: const EdgeInsets.all(14),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'البحث عن صنف...',
                prefixIcon: const Icon(Icons.search, color: AppColors.textSecondary),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          context.read<InventoryProvider>().fetchInventory();
                        },
                      )
                    : null,
              ),
              onSubmitted: (val) {
                context.read<InventoryProvider>().fetchInventory(search: val.trim());
              },
            ),
          ),

          // قائمة الأصناف
          Expanded(
            child: inventory.isLoading
                ? const Center(child: CircularProgressIndicator())
                : items.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.inventory_2_outlined, size: 54, color: AppColors.textMuted),
                            const SizedBox(height: 12),
                            const Text(
                              'لا توجد أصناف مسجلة بالمخزون حالياً',
                              style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                            ),
                            if (auth.canManagePurchases) ...[
                              const SizedBox(height: 12),
                              ElevatedButton(
                                onPressed: () => Navigator.pushNamed(context, '/items-manage'),
                                child: const Text('إضافة صنف وتوريد'),
                              ),
                            ],
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: () => context.read<InventoryProvider>().fetchInventory(),
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          itemCount: items.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final item = items[index];
                            final isLowStock = item.quantity <= 2.0;

                            return Card(
                              child: ListTile(
                                leading: Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: isLowStock
                                        ? AppColors.lossRed.withOpacity(0.12)
                                        : AppColors.secondary.withOpacity(0.2),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Icon(
                                    Icons.spa_outlined,
                                    color: isLowStock ? AppColors.lossRed : AppColors.primary,
                                  ),
                                ),
                                title: Text(
                                  item.name,
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                                ),
                                subtitle: Row(
                                  children: [
                                    Text(
                                      'المتبقي: ${item.displayQuantity}',
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                        color: isLowStock ? AppColors.lossRed : AppColors.textSecondary,
                                      ),
                                    ),
                                    if (auth.canManagePurchases && item.costPrice != null) ...[
                                      const SizedBox(width: 10),
                                      Text(
                                        'التكلفة: ${_currencyFormat.format(item.costPrice)} ريال',
                                        style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                                      ),
                                    ],
                                  ],
                                ),
                                trailing: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      '${_currencyFormat.format(item.sellPrice)} ريال',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                    const Text('سعر البيع', style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
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
