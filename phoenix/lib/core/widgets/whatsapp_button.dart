import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/utils/whatsapp_launcher.dart';

class WhatsAppButton extends StatelessWidget {
  const WhatsAppButton({super.key, required this.phone, this.size = 40});

  final String phone;
  final double size;

  static const Color _whatsappGreen = Color(0xFF25D366);

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _whatsappGreen.withValues(alpha: 0.12),
      borderRadius: AppRadius.small,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => launchWhatsApp(phone),
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(Icons.chat, color: _whatsappGreen, size: size * 0.5),
        ),
      ),
    );
  }
}
