import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';

// Section 6.2 update: the address field is gone - this embedded map is now
// the only way to set the pharmacy's location, and its resolved address is
// what gets submitted as `address` (see registration_view.dart's _submit()).
// Same geolocator/Nominatim logic as the earlier bottom-sheet picker, just
// hosted inline in the form instead of a modal - see location_picker_sheet's
// prior version in git history for that.

// Latakia, Syria - the app's only served city today (see
// auth.service.js's registerOrLogin), used only as where the map opens if
// the device's current position isn't available yet.
const _defaultCenter = LatLng(35.5317, 35.7911);

const _nominatimUserAgent = 'PhoenixPharmacyApp/1.0';

Future<bool> ensureLocationPermission() async {
  final serviceEnabled = await Geolocator.isLocationServiceEnabled();
  if (!serviceEnabled) return false;

  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  return permission == LocationPermission.always || permission == LocationPermission.whileInUse;
}

Future<String?> _reverseGeocode(LatLng point, String languageCode) async {
  try {
    final response = await Dio().get<Map<String, dynamic>>(
      'https://nominatim.openstreetmap.org/reverse',
      queryParameters: {
        'format': 'jsonv2',
        'lat': point.latitude,
        'lon': point.longitude,
        'accept-language': languageCode,
      },
      options: Options(headers: {'User-Agent': _nominatimUserAgent}),
    );
    return response.data?['display_name'] as String?;
  } catch (_) {
    // Best-effort - the map still reports its coordinates even when the
    // address lookup itself fails (rate-limited, offline, ...).
    return null;
  }
}

class LocationMapField extends StatefulWidget {
  const LocationMapField({super.key, required this.label, required this.onChanged});

  final String label;
  // Called whenever the pin settles on a new point: immediately with the
  // last-known address (possibly still null/stale), then again once
  // Nominatim resolves a fresh one for that exact point.
  final void Function(double latitude, double longitude, String? address) onChanged;

  @override
  State<LocationMapField> createState() => _LocationMapFieldState();
}

class _LocationMapFieldState extends State<LocationMapField> {
  final _mapController = MapController();
  LatLng _center = _defaultCenter;
  String? _resolvedAddress;
  bool _isResolving = true;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    // _initializeLocation eventually reads Localizations.localeOf(context)
    // (inside _resolveAddress) - calling that from an async chain kicked off
    // in initState throws even after an await, because the element hasn't
    // finished its first build yet. Deferring the kickoff to right after
    // that first frame sidesteps it entirely.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _initializeLocation();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _initializeLocation() async {
    final granted = await ensureLocationPermission();
    if (mounted && granted) {
      try {
        final position = await Geolocator.getCurrentPosition(
          timeLimit: const Duration(seconds: 6),
        );
        if (mounted) {
          _center = LatLng(position.latitude, position.longitude);
          _mapController.move(_center, 15);
        }
      } catch (_) {
        // Falls back to the default center already set.
      }
    }
    await _resolveAddress();
  }

  Future<void> _resolveAddress() async {
    if (!mounted) return;
    setState(() => _isResolving = true);
    final languageCode = Localizations.localeOf(context).languageCode;
    final address = await _reverseGeocode(_center, languageCode);
    if (!mounted) return;
    setState(() {
      _resolvedAddress = address;
      _isResolving = false;
    });
    widget.onChanged(_center.latitude, _center.longitude, address);
  }

  void _onCenterSettled(LatLng center) {
    _center = center;
    // Reports the new coordinates right away (so submit always matches
    // where the pin visually sits), with whatever address is still on
    // screen until the debounced lookup below catches up.
    widget.onChanged(center.latitude, center.longitude, _resolvedAddress);
    setState(() => _isResolving = true);
    _debounce?.cancel();
    // At most one Nominatim request per second, and never mid-drag - only
    // once the map has been still for a second.
    _debounce = Timer(const Duration(seconds: 1), _resolveAddress);
  }

  Future<void> _useCurrentLocation() async {
    final l10n = context.l10n;
    final granted = await ensureLocationPermission();
    if (!mounted) return;
    if (!granted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.locationPermissionDeniedMessage)),
      );
      return;
    }
    try {
      final position = await Geolocator.getCurrentPosition(
        timeLimit: const Duration(seconds: 6),
      );
      if (!mounted) return;
      final target = LatLng(position.latitude, position.longitude);
      _mapController.move(target, _mapController.camera.zoom);
      _onCenterSettled(target);
    } catch (_) {
      // Silently ignored - the pharmacist can still drag the map manually.
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.label,
          style: context.textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w700,
            color: AppColors.textSecondaryOf(context),
          ),
        ),
        const SizedBox(height: AppSizes.spacingXSmall),
        // Same border radius/color as AppTextField's own OutlineInputBorder -
        // reads as one more form field, not a separate floating element.
        ClipRRect(
          borderRadius: AppRadius.medium,
          child: Container(
            height: 260,
            decoration: BoxDecoration(
              borderRadius: AppRadius.medium,
              border: Border.all(color: AppColors.borderOf(context)),
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: _center,
                    initialZoom: 15,
                    onPositionChanged: (position, hasGesture) {
                      if (hasGesture && position.center != null) {
                        _onCenterSettled(position.center!);
                      }
                    },
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.phoenix.pharmacy',
                    ),
                  ],
                ),
                // The marker stays fixed at screen-center; the map pans
                // underneath it - reads as "drag to place the pin" without
                // needing a separate draggable-marker plugin.
                IgnorePointer(
                  child: Icon(Icons.location_pin, size: 40, color: AppColors.errorOf(context)),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSizes.spacingSmall),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Icon(Icons.place_outlined, size: 16, color: AppColors.textSecondaryOf(context)),
            const SizedBox(width: AppSizes.spacingXSmall),
            Expanded(
              child: Text(
                _isResolving ? l10n.resolvingAddressText : (_resolvedAddress ?? l10n.pickLocationHint),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: context.textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
            ),
            const SizedBox(width: AppSizes.spacingSmall),
            TextButton.icon(
              onPressed: _useCurrentLocation,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingSmall),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              icon: const Icon(Icons.my_location, size: 16),
              label: Text(l10n.useCurrentLocationTooltip, style: const TextStyle(fontSize: 12.5)),
            ),
          ],
        ),
      ],
    );
  }
}
