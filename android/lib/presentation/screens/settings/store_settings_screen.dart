import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة إعدادات المتجر: العملة الموحدة وطريقة احتساب تكلفة المشتريات (حصري لمالك المتجر)
class StoreSettingsScreen extends StatefulWidget {
  const StoreSettingsScreen({super.key});

  @override
  State<StoreSettingsScreen> createState() => _StoreSettingsScreenState();
}

class _StoreSettingsScreenState extends State<StoreSettingsScreen> {
  String _selectedCurrency = 'YER';
  String _selectedCosting = 'WEIGHTED_AVERAGE';
  bool _allowResponsiblePurchases = false;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final settings = context.read<StoreSettingsProvider>();
      await settings.fetchSettings();
      if (mounted) {
        setState(() {
          _selectedCurrency = settings.currency;
          _selectedCosting = settings.defaultCostingMethod;
          _allowResponsiblePurchases = settings.allowResponsiblePurchases;
          _initialized = true;
        });
      }
    });
  }

  Future<void> _handleSave() async {
    final settings = context.read<StoreSettingsProvider>();
    final ok = await settings.updateSettings(
      currency: settings.currencyLocked ? null : _selectedCurrency,
      defaultCostingMethod: _selectedCosting,
      allowResponsiblePurchases: _allowResponsiblePurchases,
    );
    if (!mounted) return;
    if (ok) {
      await context
          .read<AuthProvider>()
          .syncAllowResponsiblePurchases(_allowResponsiblePurchases);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ إعدادات المتجر بنجاح ✅')),
      );
    } else if (settings.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.lossRed,
          content: Text(settings.errorMessage!),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final settings = context.watch<StoreSettingsProvider>();

    if (!auth.canManageStoreSettings) {
      return const AppScaffold(
        title: 'إعدادات العملة والتكلفة',
        body: Center(
          child: Text('هذه الشاشة مخصصة لمالك المتجر فقط.'),
        ),
      );
    }

    if (!_initialized && settings.isLoading) {
      return const AppScaffold(
        title: 'إعدادات العملة والتكلفة',
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return AppScaffold(
      title: 'إعدادات العملة والتكلفة',
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 1) العملة الموحدة للمتجر
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.currency_exchange, color: AppColors.primary),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text(
                          'العملة الموحدة للمتجر',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: AppColors.primary,
                          ),
                        ),
                      ),
                      if (settings.currencyLocked)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppColors.warning.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.lock_outline, size: 14, color: AppColors.warning),
                              SizedBox(width: 4),
                              Text(
                                'مقفلة',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.warning,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    settings.currencyLocked
                        ? 'تم قفل تغيير العملة تلقائياً لوجود حركات مالية مسجلة بالمتجر حفاظاً على توازن الدفاتر المحاسبية.'
                        : 'تُطبق العملة المختارة بشكل موحد على جميع المبيعات والمشتريات والديون والتقارير في المتجر.',
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  ...settings.supportedCurrencies.map((c) {
                    return RadioListTile<String>(
                      contentPadding: EdgeInsets.zero,
                      activeColor: AppColors.primary,
                      value: c.code,
                      groupValue: _selectedCurrency,
                      title: Text(
                        '${c.nameAr} (${c.symbol})',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                      subtitle: Text('الرمز: ${c.code}', style: const TextStyle(fontSize: 11)),
                      onChanged: settings.currencyLocked
                          ? null
                          : (val) {
                              if (val != null) setState(() => _selectedCurrency = val);
                            },
                    );
                  }),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 2) السياسة الافتراضية لاحتساب تكلفة المشتريات
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.calculate_outlined, color: AppColors.primary),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'طريقة احتساب تكلفة الشراء الافتراضية',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: AppColors.primary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'نظراً لأن صلاحية القات 24–48 ساعة، عند بدء يوم جديد أو نفاد الكمية السابقة يُعتمد سعر الشراء الجديد تلقائياً. أما عند شراء دفعة ثانية لنفس الصنف في نفس اليوم بسعر مختلف مع وجود كمية متبقية، فيُطبّق الخيار المحدد أدناه:',
                    style: TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.5),
                  ),
                  const SizedBox(height: 12),
                  ...settings.costingOptions.map((opt) {
                    final selected = _selectedCosting == opt.code;
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: BoxDecoration(
                        color: selected ? AppColors.secondary.withOpacity(0.15) : Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: selected ? AppColors.primary : AppColors.border,
                          width: selected ? 1.5 : 1.0,
                        ),
                      ),
                      child: RadioListTile<String>(
                        activeColor: AppColors.primary,
                        value: opt.code,
                        groupValue: _selectedCosting,
                        title: Text(
                          opt.labelAr,
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                        subtitle: Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            opt.descriptionAr,
                            style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                          ),
                        ),
                        onChanged: (val) {
                          if (val != null) setState(() => _selectedCosting = val);
                        },
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 3) صلاحية المشتريات وحسابات الموردين للعامل المسؤول (افتراضياً: منع)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.admin_panel_settings_outlined, color: AppColors.primary),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'صلاحيات المشتريات والموردين للعامل المسؤول',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: AppColors.primary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    activeColor: AppColors.primary,
                    value: _allowResponsiblePurchases,
                    title: Text(
                      _allowResponsiblePurchases
                          ? 'مسموح للعامل المسؤول (مُفعّل)'
                          : 'ممنوع عن العامل المسؤول (الوضع الافتراضي)',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        color: _allowResponsiblePurchases
                            ? AppColors.cashGreen
                            : AppColors.textPrimary,
                      ),
                    ),
                    subtitle: const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text(
                        'الحالة الافتراضية هي المنع التام. عند تفعيل هذا الخيار يستطيع العامل المسؤول فقط تسجيل فواتير الشراء وإدارة الموردين وسداد دفعاتهم، بينما يظل العمال العاديون ممنوعين تماماً.',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                          height: 1.5,
                        ),
                      ),
                    ),
                    onChanged: (val) {
                      setState(() => _allowResponsiblePurchases = val);
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          ElevatedButton.icon(
            onPressed: settings.isLoading ? null : _handleSave,
            icon: const Icon(Icons.save_outlined),
            label: Text(settings.isLoading ? 'جاري الحفظ...' : 'حفظ الإعدادات'),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
        ],
      ),
    );
  }
}

