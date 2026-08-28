import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';

// `[ − ] [ n ] [ + ]` where the middle is a real number field you can type
// into, flanked by step buttons - so a big quantity is one keystroke, not 99
// taps. Holds no quantity of its own beyond the text being edited right now:
// [quantity] is the source of truth (pass it straight from cart state) and
// every change - a tap or a typed value - is reported through [onChanged] with
// a value >= [minQuantity].
//
// Trying to go below [minQuantity] (tapping − at the floor, or typing 0 /
// clearing the field) calls [onBelowMin] when supplied - the cart uses this
// for its "remove this item?" confirmation - otherwise the value just snaps
// back to [minQuantity].
//
// Plain [Row] layout, so it mirrors correctly under RTL with no manual
// handling, and every colour comes from AppColors.*Of(context) for light/dark.
class QuantityStepper extends StatefulWidget {
  const QuantityStepper({
    super.key,
    required this.quantity,
    required this.onChanged,
    this.onBelowMin,
    this.minQuantity = 1,
    this.maxDigits = 4,
    this.liveUpdate = false,
    this.decrementTooltip,
    this.incrementTooltip,
    this.compact = false,
  });

  final int quantity;
  final ValueChanged<int> onChanged;
  final VoidCallback? onBelowMin;
  final int minQuantity;
  final int maxDigits;

  // false (default): a typed value is reported only when the field is
  // committed (blur / keyboard "done") - keeps the cart total from flickering
  // through 2 -> 25 while someone types "25". true: report every valid
  // keystroke - fine where the target is a throwaway local value, e.g. the
  // pre-add quantity sheet.
  final bool liveUpdate;

  final String? decrementTooltip;
  final String? incrementTooltip;

  // Slightly tighter sizing for dense spots like a grid product card. The +/−
  // tap targets stay at least 44 logical px square either way.
  final bool compact;

  @override
  State<QuantityStepper> createState() => _QuantityStepperState();
}

class _QuantityStepperState extends State<QuantityStepper> {
  late final TextEditingController _controller = TextEditingController(text: '${widget.quantity}');
  late final FocusNode _focusNode = FocusNode()..addListener(_onFocusChange);

  @override
  void didUpdateWidget(covariant QuantityStepper oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Reflect a change that came from elsewhere (a +/- tap, the same product
    // re-added from the catalog, the cart edited on another screen) without
    // clobbering what the user is typing into this field right now.
    if (oldWidget.quantity != widget.quantity && !_focusNode.hasFocus) {
      _controller.text = '${widget.quantity}';
    }
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _onFocusChange() {
    if (!_focusNode.hasFocus) _commitTyped();
  }

  void _onTextChanged(String raw) {
    final parsed = int.tryParse(raw.trim());
    if (parsed != null && parsed >= widget.minQuantity && parsed != widget.quantity) {
      widget.onChanged(parsed);
    }
  }

  // Called when the field loses focus / the keyboard's "done" is pressed. The
  // digits-only formatter means the text is always either digits or empty.
  void _commitTyped() {
    final parsed = int.tryParse(_controller.text.trim());

    // Empty, or a number below the floor (0): the cart reads this as "remove
    // this line" (its onBelowMin opens the confirmation), the pre-add sheet
    // just snaps back to the minimum.
    if (parsed == null || parsed < widget.minQuantity) {
      if (widget.onBelowMin != null) {
        widget.onBelowMin!();
      } else if (widget.quantity != widget.minQuantity) {
        widget.onChanged(widget.minQuantity);
      }
      _controller.text = '${widget.quantity}';
      return;
    }
    if (parsed != widget.quantity) {
      widget.onChanged(parsed);
    } else {
      _controller.text = '${widget.quantity}'; // normalise e.g. "007" -> "7"
    }
  }

  void _step(int delta) {
    // Respect a value the user has typed but not committed yet.
    final typed = int.tryParse(_controller.text.trim());
    final base = (typed != null && typed >= widget.minQuantity) ? typed : widget.quantity;
    final next = base + delta;

    if (next < widget.minQuantity) {
      widget.onBelowMin?.call();
      return;
    }
    _controller.text = '$next';
    _controller.selection = TextSelection.collapsed(offset: _controller.text.length);
    widget.onChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    final double buttonSize = widget.compact ? 44 : 48;
    final canDecrement = widget.onBelowMin != null || widget.quantity > widget.minQuantity;
    final textStyle = (widget.compact ? context.textTheme.titleSmall : context.textTheme.titleMedium)
        ?.copyWith(fontWeight: FontWeight.w700);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.surfaceOf(context),
        borderRadius: AppRadius.small,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _StepButton(
            icon: Icons.remove,
            size: buttonSize,
            tooltip: widget.decrementTooltip,
            onPressed: canDecrement ? () => _step(-1) : null,
          ),
          SizedBox(
            width: widget.compact ? 34 : 44,
            child: TextField(
              controller: _controller,
              focusNode: _focusNode,
              textAlign: TextAlign.center,
              keyboardType: const TextInputType.numberWithOptions(),
              textInputAction: TextInputAction.done,
              onChanged: widget.liveUpdate ? _onTextChanged : null,
              onSubmitted: (_) => _focusNode.unfocus(),
              onTapOutside: (_) => _focusNode.unfocus(),
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(widget.maxDigits),
              ],
              style: textStyle,
              decoration: const InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 8),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
              ),
            ),
          ),
          _StepButton(
            icon: Icons.add,
            size: buttonSize,
            tooltip: widget.incrementTooltip,
            onPressed: () => _step(1),
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({
    required this.icon,
    required this.size,
    required this.onPressed,
    this.tooltip,
  });

  final IconData icon;
  final double size;
  final VoidCallback? onPressed;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onPressed,
      tooltip: tooltip,
      iconSize: 18,
      padding: EdgeInsets.zero,
      constraints: BoxConstraints.tightFor(width: size, height: size),
      style: IconButton.styleFrom(
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        foregroundColor: AppColors.primaryOf(context),
        disabledForegroundColor: AppColors.textSecondaryOf(context).withValues(alpha: 0.4),
      ),
      icon: Icon(icon),
    );
  }
}
