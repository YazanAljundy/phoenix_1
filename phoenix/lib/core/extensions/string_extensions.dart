extension StringExtensions on String {
  bool get isValidEmail {
    final RegExp regex = RegExp(
      r'^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$',
    );
    return regex.hasMatch(this);
  }

  bool get isValidPassword => trim().length >= 6;
}
