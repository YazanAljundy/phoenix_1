import 'package:flutter/material.dart';

import '../constants/app_strings.dart';

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, this.message = AppStrings.emptyState});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(child: Text(message));
  }
}
