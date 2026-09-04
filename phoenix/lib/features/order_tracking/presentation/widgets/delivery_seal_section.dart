import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/constants/image_upload.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_network_image.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/order_tracking/presentation/managers/order_tracking_cubit.dart';

// Section: optional delivery seal photo. Two states, one card:
//  * the order still needs the photo -> pick (camera/gallery) + preview +
//    retake + a "confirm delivery" button that uploads it;
//  * the photo is already attached -> a calm read-only view of it.
// Only rendered by order_tracking_view.dart when one of those applies, so it
// never shows for a warehouse that left the setting off. Confirming does NOT
// advance the order - the warehouse still finalises it (the backend just won't
// let it reach 'delivered' until this photo exists).
class DeliverySealSection extends StatefulWidget {
  const DeliverySealSection({super.key, required this.order, required this.isConfirming});

  final OrderModel order;
  final bool isConfirming;

  @override
  State<DeliverySealSection> createState() => _DeliverySealSectionState();
}

class _DeliverySealSectionState extends State<DeliverySealSection> {
  XFile? _picked;

  Future<void> _pickWithSourceChoice() async {
    final l10n = context.l10n;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_rounded),
              title: Text(l10n.cameraOption),
              onTap: () => Navigator.pop(sheetContext, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: Text(l10n.galleryOption),
              onTap: () => Navigator.pop(sheetContext, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    if (source == ImageSource.camera) {
      // Gallery needs no runtime permission (system pickers); only the camera
      // does. Same handling as request_return_sheet.dart.
      final status = await Permission.camera.request();
      if (!mounted) return;
      if (!status.isGranted) {
        final permanentlyBlocked = status.isPermanentlyDenied || status.isRestricted;
        await AppDialog.show(
          context: context,
          title: l10n.permissionRequiredTitle,
          content: l10n.cameraPermissionDenied,
          actionLabel: permanentlyBlocked ? l10n.openSettings : null,
          onAction: permanentlyBlocked ? () => openAppSettings() : null,
        );
        return;
      }
    }

    // image_picker does the resize + JPEG re-encode natively in one pass
    // (kReturnPhotoMaxDimension / kReturnPhotoQuality) - the same processed
    // bytes are what get uploaded (OrderRepositoryImpl).
    final XFile? photo = await ImagePicker().pickImage(
      source: source,
      maxWidth: kReturnPhotoMaxDimension,
      maxHeight: kReturnPhotoMaxDimension,
      imageQuality: kReturnPhotoQuality,
    );
    if (photo == null || !mounted) return;
    setState(() => _picked = photo);
  }

  Future<void> _confirm() async {
    final photo = _picked;
    if (photo == null) return;
    final ok = await context.read<OrderTrackingCubit>().confirmDelivery(photo);
    // On success the cubit reloads the order and this section re-renders into
    // its read-only state; drop the local pick. On failure keep it so the
    // pharmacist can just tap "confirm" again (the error dialog is shown by
    // the parent view's BlocConsumer listener).
    if (ok && mounted) setState(() => _picked = null);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final order = widget.order;

    if (order.deliverySealPhotoUrl != null) {
      return CustomCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.verified_outlined, color: AppColors.secondaryOf(context)),
                const SizedBox(width: AppSizes.spacingSmall),
                Expanded(child: Text(l10n.sealPhotoLabel, style: context.textTheme.titleMedium)),
              ],
            ),
            const SizedBox(height: AppSizes.spacingSmall),
            ClipRRect(
              borderRadius: AppRadius.small,
              child: AppNetworkImage(
                url: order.deliverySealPhotoUrl,
                width: double.infinity,
                height: 200,
                fit: BoxFit.cover,
              ),
            ),
            if (order.deliverySealConfirmedAt != null) ...[
              const SizedBox(height: AppSizes.spacingSmall),
              Text(
                l10n.deliverySealConfirmedOn(
                  DateFormatter.formatDateTime(order.deliverySealConfirmedAt!),
                ),
                style: context.textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
            ],
          ],
        ),
      );
    }

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.deliverySealRequiredTitle, style: context.textTheme.titleMedium),
          const SizedBox(height: AppSizes.spacingXSmall),
          Text(
            l10n.deliverySealRequiredMessage,
            style: context.textTheme.bodyMedium?.copyWith(
              color: AppColors.textSecondaryOf(context),
            ),
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          if (_picked == null)
            InkWell(
              onTap: widget.isConfirming ? null : _pickWithSourceChoice,
              borderRadius: AppRadius.small,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingLarge),
                decoration: BoxDecoration(
                  borderRadius: AppRadius.small,
                  border: Border.all(color: AppColors.borderOf(context)),
                ),
                child: Column(
                  children: [
                    Icon(Icons.add_a_photo_outlined, color: AppColors.textSecondaryOf(context)),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    Text(l10n.takeSealPhoto),
                  ],
                ),
              ),
            )
          else ...[
            ClipRRect(
              borderRadius: AppRadius.small,
              child: _PickedPreview(image: _picked!),
            ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: widget.isConfirming ? null : _pickWithSourceChoice,
                icon: const Icon(Icons.refresh, size: 18),
                label: Text(l10n.retakeSealPhoto),
              ),
            ),
          ],
          const SizedBox(height: AppSizes.spacingMedium),
          PrimaryButton(
            label: l10n.confirmDeliveryButton,
            isLoading: widget.isConfirming,
            onPressed: _picked == null ? null : _confirm,
          ),
        ],
      ),
    );
  }
}

// Reads the picked file's bytes once and shows them - Image.memory keeps this
// web-safe (no dart:io), same approach as request_return_sheet.dart's
// _NewPhotoThumbnail.
class _PickedPreview extends StatefulWidget {
  const _PickedPreview({required this.image});

  final XFile image;

  @override
  State<_PickedPreview> createState() => _PickedPreviewState();
}

class _PickedPreviewState extends State<_PickedPreview> {
  late Future<Uint8List> _bytes = widget.image.readAsBytes();

  @override
  void didUpdateWidget(covariant _PickedPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.image.path != widget.image.path) {
      _bytes = widget.image.readAsBytes();
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: _bytes,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return Container(height: 200, color: AppColors.borderOf(context));
        }
        return Image.memory(
          snapshot.data!,
          width: double.infinity,
          height: 200,
          fit: BoxFit.cover,
          cacheWidth: 1200,
        );
      },
    );
  }
}
