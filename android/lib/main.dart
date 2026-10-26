import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'core/network/api_client.dart';
import 'core/theme/app_theme.dart';
import 'data/repositories/auth_repository.dart';
import 'presentation/providers/auth_provider.dart';
import 'presentation/providers/credit_provider.dart';
import 'presentation/providers/daily_closing_provider.dart';
import 'presentation/providers/dashboard_provider.dart';
import 'presentation/providers/inventory_provider.dart';
import 'presentation/providers/sales_provider.dart';

import 'presentation/screens/auth/account_locked_screen.dart';
import 'presentation/screens/auth/login_screen.dart';
import 'presentation/screens/auth/set_new_password_screen.dart';
import 'presentation/screens/auth/signup_screen.dart';
import 'presentation/screens/closing/daily_closing_screen.dart';
import 'presentation/screens/credit/credit_screen.dart';
import 'presentation/screens/expenses/expenses_screen.dart';
import 'presentation/screens/funds/funds_screen.dart';
import 'presentation/screens/home/home_screen.dart';
import 'presentation/screens/inventory/damaged_goods_screen.dart';
import 'presentation/screens/inventory/inventory_screen.dart';
import 'presentation/screens/inventory/items_manage_screen.dart';
import 'presentation/screens/reports/reports_screen.dart';
import 'presentation/screens/sales/operations_log_screen.dart';
import 'presentation/screens/sales/sell_screen.dart';
import 'presentation/screens/sales/sold_items_screen.dart';
import 'presentation/screens/sync/backup_screen.dart';
import 'presentation/screens/sync/rejected_transactions_screen.dart';
import 'presentation/screens/workers/workers_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final apiClient = ApiClient();
  final authRepo = AuthRepository(apiClient);

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider(authRepo)..init()),
        ChangeNotifierProvider(create: (_) => DashboardProvider(apiClient)),
        ChangeNotifierProvider(create: (_) => InventoryProvider(apiClient)),
        ChangeNotifierProvider(create: (_) => SalesProvider(apiClient)),
        ChangeNotifierProvider(create: (_) => CreditProvider(apiClient)),
        ChangeNotifierProvider(create: (_) => DailyClosingProvider(apiClient)),
      ],
      child: const MuqawatiApp(),
    ),
  );
}

class MuqawatiApp extends StatelessWidget {
  const MuqawatiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'مَقوتي',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          if (auth.isLoading && auth.status == AuthStatus.initial) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          if (auth.status == AuthStatus.accountLocked) {
            return const AccountLockedScreen();
          }
          if (auth.status == AuthStatus.mustChangePassword) {
            return const SetNewPasswordScreen();
          }
          if (auth.isAuthenticated) {
            return const HomeScreen();
          }
          return const LoginScreen();
        },
      ),
      routes: {
        '/login': (_) => const LoginScreen(),
        '/signup': (_) => const SignupScreen(),
        '/account-locked': (_) => const AccountLockedScreen(),
        '/set-new-password': (_) => const SetNewPasswordScreen(),
        '/home': (_) => const HomeScreen(),
        '/sell': (_) => const SellScreen(),
        '/inventory': (_) => const InventoryScreen(),
        '/items-manage': (_) => const ItemsManageScreen(),
        '/damaged-goods': (_) => const DamagedGoodsScreen(),
        '/sold-items': (_) => const SoldItemsScreen(),
        '/operations-log': (_) => const OperationsLogScreen(),
        '/credit': (_) => const CreditScreen(),
        '/expenses': (_) => const ExpensesScreen(),
        '/daily-closing': (_) => const DailyClosingScreen(),
        '/funds': (_) => const FundsScreen(),
        '/workers': (_) => const WorkersScreen(),
        '/managed-workers': (_) => const WorkersScreen(isManagedOnly: true),
        '/rejected-transactions': (_) => const RejectedTransactionsScreen(),
        '/reports': (_) => const ReportsScreen(),
        '/backup': (_) => const BackupScreen(),
      },
    );
  }
}
