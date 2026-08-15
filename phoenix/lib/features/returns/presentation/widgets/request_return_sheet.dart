import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/cart/data/models/order_line_item.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/presentation/managers/request_return_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/request_return_state.dart';
import 'package:phoenix/features/returns/presentation/utils/return_labels.dart';

// Section 6.9: one return per order, covering every problem item in it at
// once - so this sheet is item-picking, not single-item. Reused for both
// creating a new return (existingReturn == null) and editing a still-pending
// one (existingReturn != null, pre-filled).
Future<ReturnModel?> showRequestReturnSheet(
  BuildContext context, {
  required String orderId,
  ReturnModel? existingReturn,
}) {
  final returnRepository = context.read<ReturnRepository>();
  final orderRepository = context.read<OrderRepository>();
  return showModalBottomSheet<ReturnModel>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (sheetContext) {
      return BlocProvider(
        create: (_) => RequestReturnCubit(
          returnRepository: returnRepository,
          orderRepository: orderRepository,
          orderId: orderId,
          existingReturn: existingReturn,
        )..initialize(),
        child: const _RequestReturnSheetBody(),
      );
    },
  );
}

class _RequestReturnSheetBody extends StatefulWidget {
  const _RequestReturnSheetBody();

  @override
  State<_RequestReturnSheetBody> createState() => _RequestReturnSheetBodyState();
}

class _RequestReturnSheetBodyState extends State<_RequestReturnSheetBody> {
  final _customReasonControllers = <String, TextEditingController>{};
  late final TextEditingController _notesController;
  bool _notesInitialized = false;

  TextEditingController _customReasonController(String orderItemId, String initial) {
    return _customReasonControllers.putIfAbsent(
      orderItemId,
      () => TextEditingController(text: initial),
    );
  }

  @override
  void initState() {
    super.initState();
    _notesController = TextEditingController();
  }

  @override
  void dispose() {
    for (final controller in _customReasonControllers.values) {
      controller.dispose();
    }
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _addPhotos(RequestReturnCubit cubit) async {
    final remaining =
        kMaxReturnPhotos - cubit.state.existingImageUrls.length - cubit.state.newImages.length;
    if (remaining <= 0) return;
    final picked = await ImagePicker().pickMultiImage(imageQuality: 85, limit: remaining);
    if (picked.isEmpty || !mounted) return;
    cubit.addImages(picked);
  }

  Future<void> _submit(RequestReturnCubit cubit) async {
    final result = await cubit.submit();
    if (!mounted || result == null) return;
    Navigator.pop(context, result);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return BlocConsumer<RequestReturnCubit, RequestReturnState>(
      listenWhen: (previous, current) =>
          current.errorMessage != null && previous.errorMessage != current.errorMessage,
      listener: (context, state) {
        AppSnackbar.show(context, translateErrorCode(l10n, state.errorCode, state.errorMessage!));
      },
      builder: (context, state) {
        final cubit = context.read<RequestReturnCubit>();

        if (state.status == RequestReturnStatus.loading) {
          return const SizedBox(height: 200, child: AppLoading());
        }

        if (!_notesInitialized && state.notes.isNotEmpty) {
          _notesController.text = state.notes;
          _notesInitialized = true;
        }

        return Padding(
          padding: EdgeInsets.only(
            left: AppSizes.spacingLarge,
            right: AppSizes.spacingLarge,
            top: AppSizes.spacingLarge,
            bottom: MediaQuery.of(context).viewInsets.bottom + AppSizes.spacingLarge,
          ),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l10n.requestReturnTitle, style: context.textTheme.titleLarge),
                const SizedBox(height: AppSizes.spacingMedium),
                Text(l10n.returnPickItemsLabel, style: context.textTheme.titleSmall),
                const SizedBox(height: AppSizes.spacingSmall),
                ...state.orderItems.map((item) {
                  final selected = state.selectedItemIds.contains(item.id);
                  final name = isArabic ? item.productNameAr : item.productNameEn;
                  return _ReturnItemTile(
                    item: item,
                    name: name,
                    selected: selected,
                    quantity: state.itemQuantity[item.id] ?? 1,
                    reasonType: state.itemReasonType[item.id] ?? kReturnReasonTypes.first,
                    customReasonController: _customReasonController(
                      item.id,
                      state.itemCustomReason[item.id] ?? '',
                    ),
                    onToggle: () => cubit.toggleItem(item.id),
                    onQuantityChanged: (q) => cubit.setItemQuantity(item.id, q),
                    onReasonChanged: (r) => cubit.setItemReasonType(item.id, r),
                    onCustomReasonChanged: (v) => cubit.setItemCustomReason(item.id, v),
                  );
                }),
                const SizedBox(height: AppSizes.spacingMedium),
                AppTextField(
                  label: l10n.notesLabel,
                  controller: _notesController,
                  onChanged: cubit.setNotes,
                ),
                const SizedBox(height: AppSizes.spacingMedium),
                Text(l10n.returnPhotosLabel, style: context.textTheme.titleSmall),
                const SizedBox(height: AppSizes.spacingSmall),
                Wrap(
                  spacing: AppSizes.spacingSmall,
                  runSpacing: AppSizes.spacingSmall,
                  children: [
                    for (final url in state.existingImageUrls)
                      _ExistingPhotoThumbnail(url: url, onRemove: () => cubit.removeExistingImage(url)),
                    for (var i = 0; i < state.newImages.length; i++)
                      _NewPhotoThumbnail(
                        image: state.newImages[i],
                        onRemove: () => cubit.removeNewImageAt(i),
                      ),
                    if (state.existingImageUrls.length + state.newImages.length < kMaxReturnPhotos)
                      InkWell(
                        onTap: () => _addPhotos(cubit),
                        borderRadius: AppRadius.small,
                        child: Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            borderRadius: AppRadius.small,
                            border: Border.all(color: AppColors.borderOf(context)),
                          ),
                          child: Icon(
                            Icons.add_a_photo_outlined,
                            color: AppColors.textSecondaryOf(context),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: AppSizes.spacingXLarge),
                PrimaryButton(
                  label: l10n.requestReturnButton,
                  isLoading: state.isSubmitting,
                  onPressed: cubit.isValid ? () => _submit(cubit) : () {},
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ReturnItemTile extends StatelessWidget {
  const _ReturnItemTile({
    required this.item,
    required this.name,
    required this.selected,
    required this.quantity,
    required this.reasonType,
    required this.customReasonController,
    required this.onToggle,
    required this.onQuantityChanged,
    required this.onReasonChanged,
    required this.onCustomReasonChanged,
  });

  final OrderLineItem item;
  final String name;
  final bool selected;
  final int quantity;
  final String reasonType;
  final TextEditingController customReasonController;
  final VoidCallback onToggle;
  final ValueChanged<int> onQuantityChanged;
  final ValueChanged<String> onReasonChanged;
  final ValueChanged<String> onCustomReasonChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Container(
      margin: const EdgeInsets.only(bottom: AppSizes.spacingSmall),
      padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingSmall, vertical: 4),
      decoration: BoxDecoration(
        borderRadius: AppRadius.medium,
        border: Border.all(
          color: selected ? AppColors.primaryOf(context) : AppColors.borderOf(context),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CheckboxListTile(
            value: selected,
            onChanged: (_) => onToggle(),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(name),
            subtitle: Text('${l10n.returnQuantityLabel}: ${item.quantity}'),
          ),
          if (selected) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: AppSizes.spacingSmall),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(l10n.returnQuantityLabel, style: context.textTheme.bodyMedium),
                      const Spacer(),
                      IconButton(
                        onPressed: quantity > 1 ? () => onQuantityChanged(quantity - 1) : null,
                        icon: const Icon(Icons.remove_circle_outline),
                      ),
                      Text('$quantity', style: context.textTheme.titleMedium),
                      IconButton(
                        onPressed: quantity < item.quantity ? () => onQuantityChanged(quantity + 1) : null,
                        icon: const Icon(Icons.add_circle_outline),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSizes.spacingXSmall),
                  Text(l10n.returnReasonLabel, style: context.textTheme.bodyMedium),
                  const SizedBox(height: AppSizes.spacingXSmall),
                  Wrap(
                    spacing: AppSizes.spacingSmall,
                    children: kReturnReasonTypes.map((type) {
                      return ChoiceChip(
                        label: Text(returnReasonLabel(l10n, type)),
                        selected: reasonType == type,
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.full),
                        onSelected: (_) => onReasonChanged(type),
                      );
                    }).toList(),
                  ),
                  if (reasonType == 'other') ...[
                    const SizedBox(height: AppSizes.spacingSmall),
                    AppTextField(
                      label: l10n.customReasonLabel,
                      controller: customReasonController,
                      onChanged: onCustomReasonChanged,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _NewPhotoThumbnail extends StatelessWidget {
  const _NewPhotoThumbnail({required this.image, required this.onRemove});

  final XFile image;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return _PhotoThumbnailFrame(
      onRemove: onRemove,
      child: FutureBuilder<Uint8List>(
        future: image.readAsBytes(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return Container(width: 64, height: 64, color: AppColors.borderOf(context));
          }
          return Image.memory(snapshot.data!, width: 64, height: 64, fit: BoxFit.cover);
        },
      ),
    );
  }
}

class _ExistingPhotoThumbnail extends StatelessWidget {
  const _ExistingPhotoThumbnail({required this.url, required this.onRemove});

  final String url;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return _PhotoThumbnailFrame(
      onRemove: onRemove,
      child: Image.network(url, width: 64, height: 64, fit: BoxFit.cover),
    );
  }
}

class _PhotoThumbnailFrame extends StatelessWidget {
  const _PhotoThumbnailFrame({required this.child, required this.onRemove});

  final Widget child;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ClipRRect(borderRadius: AppRadius.small, child: child),
        PositionedDirectional(
          top: -4,
          end: -4,
          child: InkWell(
            onTap: onRemove,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
              child: const Icon(Icons.close, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}
