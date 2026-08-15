import 'package:flutter/material.dart';

class LoadingOverlay extends StatelessWidget {
  const LoadingOverlay({
    super.key,
    required this.isLoading,
    required this.child,
  });

  final bool isLoading;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        if (isLoading)
          const ModalBarrier(dismissible: false, color: Colors.black26)
        else
          const SizedBox.shrink(),
        if (isLoading)
          const Center(child: CircularProgressIndicator())
        else
          const SizedBox.shrink(),
      ],
    );
  }
}
