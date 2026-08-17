import 'package:flutter/material.dart';
import 'package:phoenix/core/utils/whatsapp_launcher.dart';

class WhatsAppButton extends StatelessWidget {
  const WhatsAppButton({super.key, required this.phone});

  final String phone;

  static const Color _whatsappGreen = Color(0xFF25D366);

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.chat, color: _whatsappGreen),
      tooltip: 'WhatsApp',
      onPressed: () => launchWhatsApp(phone),
    );
  }
}
