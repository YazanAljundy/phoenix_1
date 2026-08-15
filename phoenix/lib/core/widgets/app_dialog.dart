import 'package:flutter/material.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';

class AppDialog {
  const AppDialog._();

  static Future<void> show({
    required BuildContext context,
    required String title,
    required String content,
    String? actionLabel,
    VoidCallback? onAction,
  }) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(content),
        actions: [
          TextButton(
            onPressed: () {
              if (Navigator.of(dialogContext, rootNavigator: true).canPop()) {
                Navigator.of(dialogContext, rootNavigator: true).pop();
              }
            },
            child: Text(dialogContext.l10n.close),
          ),
          if (actionLabel != null && onAction != null)
            TextButton(
              onPressed: () {
                if (Navigator.of(dialogContext, rootNavigator: true).canPop()) {
                  Navigator.of(dialogContext, rootNavigator: true).pop();
                }
                onAction();
              },
              child: Text(actionLabel),
            ),
        ],
      ),
    );
  }
}
