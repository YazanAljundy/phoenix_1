import { describe, expect, it } from 'vitest';
import en from './en/translation.json';
import ar from './ar/translation.json';

// The delivery-seal-photo UI (WarehouseSettingsPage toggle, WarehouseOrderDetailPage
// hint/photo, AdminComplaintDetailPage photo) is plain React with no jsdom
// harness here, so what is testable is its l10n contract: every key it renders
// exists in both locales and the {{date}} placeholders line up.

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('delivery seal photo translations', () => {
  it('the warehouse settings toggle exists in both locales', () => {
    for (const key of ['requireSealPhotoLabel', 'requireSealPhotoHint']) {
      expect(nonEmptyString(en.warehouseSettings[key]), `en.warehouseSettings.${key}`).toBe(true);
      expect(nonEmptyString(ar.warehouseSettings[key]), `ar.warehouseSettings.${key}`).toBe(true);
      expect(ar.warehouseSettings[key], `ar.warehouseSettings.${key} is not the EN fallback`).not.toBe(
        en.warehouseSettings[key]
      );
    }
  });

  it('the warehouse order-detail keys exist in both locales', () => {
    for (const key of [
      'deliverySealPhoto',
      'deliverySealConfirmedAt',
      'awaitingDeliverySealPhoto',
      'sealRequirementTitle',
      'sealRequirementToggle',
      'sealRequirementHint',
    ]) {
      expect(nonEmptyString(en.orderDetail[key]), `en.orderDetail.${key}`).toBe(true);
      expect(nonEmptyString(ar.orderDetail[key]), `ar.orderDetail.${key}`).toBe(true);
    }
  });

  it('the admin complaint-detail keys exist in both locales', () => {
    for (const key of ['deliverySealPhoto', 'deliverySealConfirmedAt']) {
      expect(nonEmptyString(en.complaints.detail[key]), `en.complaints.detail.${key}`).toBe(true);
      expect(nonEmptyString(ar.complaints.detail[key]), `ar.complaints.detail.${key}`).toBe(true);
    }
  });

  it('the {{date}} placeholder is present in both locales wherever it is used', () => {
    for (const [root, pathStr] of [
      [en, 'orderDetail.deliverySealConfirmedAt'],
      [ar, 'orderDetail.deliverySealConfirmedAt'],
      [en, 'complaints.detail.deliverySealConfirmedAt'],
      [ar, 'complaints.detail.deliverySealConfirmedAt'],
    ]) {
      const value = pathStr.split('.').reduce((node, part) => node[part], root);
      expect(value, pathStr).toContain('{{date}}');
    }
  });
});
