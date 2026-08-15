import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';

import 'my_returns_state.dart';

class MyReturnsCubit extends Cubit<MyReturnsState> {
  MyReturnsCubit({required ReturnRepository returnRepository})
    : _returnRepository = returnRepository,
      super(const MyReturnsState());

  final ReturnRepository _returnRepository;

  Future<void> load() async {
    emit(state.copyWith(status: MyReturnsStatus.loading, clearError: true));
    try {
      final returns = await _returnRepository.getReturns();
      emit(state.copyWith(status: MyReturnsStatus.loaded, returns: returns));
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: MyReturnsStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }

  // Section 6.9: deletable only while pending - the sheet/tile that exposes
  // this already hides the action once a return is decided.
  Future<bool> delete(String returnId) async {
    try {
      await _returnRepository.deleteReturn(returnId);
      await load();
      return true;
    } on Failure catch (f) {
      emit(state.copyWith(errorMessage: f.errMessage, errorCode: f.code));
      return false;
    }
  }
}
