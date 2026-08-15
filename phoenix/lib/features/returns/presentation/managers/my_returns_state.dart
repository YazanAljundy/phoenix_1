import 'package:phoenix/features/returns/data/models/return_model.dart';

enum MyReturnsStatus { initial, loading, loaded, error }

class MyReturnsState {
  const MyReturnsState({
    this.status = MyReturnsStatus.initial,
    this.returns = const [],
    this.errorMessage,
    this.errorCode,
  });

  final MyReturnsStatus status;
  final List<ReturnModel> returns;
  final String? errorMessage;
  final String? errorCode;

  MyReturnsState copyWith({
    MyReturnsStatus? status,
    List<ReturnModel>? returns,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
  }) {
    return MyReturnsState(
      status: status ?? this.status,
      returns: returns ?? this.returns,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
    );
  }
}
