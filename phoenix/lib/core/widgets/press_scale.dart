import 'package:flutter/material.dart';

import '../constants/app_duration.dart';

/// Wraps [child] with a light scale-down while pressed (Section 2-c of the
/// visual-polish pass) - purely a presentational overlay. It watches raw
/// pointer down/up/cancel events rather than registering its own tap
/// recognizer, so it never competes with or duplicates whatever tap
/// handling [child] already owns (an ElevatedButton's onPressed, an
/// InkWell's onTap, ...) - nesting a second GestureDetector.onTap around an
/// already-tappable child is a known way to fire that callback twice per
/// tap, which this sidesteps entirely.
class PressScale extends StatefulWidget {
  const PressScale({super.key, required this.child, this.scale = 0.95});

  final Widget child;
  final double scale;

  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _setPressed(true),
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: AnimatedScale(
        scale: _pressed ? widget.scale : 1.0,
        duration: AppDuration.pressScale,
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}
