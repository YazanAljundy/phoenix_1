import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { formatSyp } from '../utils/currency';

// Money-Flow V2. What the warehouse sold in a period, what came back, what the
// platform is owed, and what the warehouse keeps.
//
// V1 computed a commission on every order and showed it nowhere, so a warehouse
// could not see what a package deal actually netted it. Every figure here is
// SYP - the settlement currency - and a sum of frozen per-order values, never a
// live re-conversion.
//
// The vocabulary is kept deliberately separate: SALES is what pharmacies were
// charged (not what was collected in cash - that is the account balance's job),
// COMMISSION is what the platform is owed, NET is what the warehouse keeps.

function toDateInputValue(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function startOfThisMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function SummaryTile({ label, value, hint, tone }) {
  return (
    <div className={`wh-settlement-tile${tone ? ` is-${tone}` : ''}`}>
      <div className="wh-settlement-tile-label">{label}</div>
      <div className="wh-settlement-tile-value wh-num">{value}</div>
      {hint && <div className="wh-settlement-tile-hint">{hint}</div>}
    </div>
  );
}

export function WarehouseSettlementPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(toDateInputValue(startOfThisMonth()));
  const [to, setTo] = useState(toDateInputValue(new Date()));
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.warehouseSettlement({ from, to });
      setData(response.settlement);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals;
  const hasReturns = Boolean(totals && totals.creditedSalesSyp > 0);

  return (
    <div>
      <div className="wh-page-head">
        <h1>{t('nav.settlement')}</h1>
      </div>

      <div className="wh-card wh-settlement-filters">
        <label>
          {t('settlement.from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('settlement.to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isLoading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : !totals ? null : (
        <>
          <div className="wh-settlement-summary">
            <SummaryTile
              label={t('settlement.sales')}
              value={formatSyp(totals.grossSalesSyp)}
              hint={t('settlement.salesHint', { count: totals.orderCount })}
            />
            {/* Only worth the space once something has actually come back. */}
            {hasReturns && (
              <SummaryTile
                label={t('settlement.credited')}
                value={`- ${formatSyp(totals.creditedSalesSyp)}`}
                hint={t('settlement.creditedHint')}
              />
            )}
            <SummaryTile
              label={t('settlement.commission')}
              value={`- ${formatSyp(totals.netCommissionSyp)}`}
              hint={
                totals.commissionClawbackSyp > 0
                  ? t('settlement.commissionAfterClawback', {
                      gross: formatSyp(totals.grossCommissionSyp),
                      clawback: formatSyp(totals.commissionClawbackSyp),
                    })
                  : t('settlement.commissionHint')
              }
              tone="cost"
            />
            <SummaryTile
              label={t('settlement.net')}
              value={formatSyp(totals.warehouseNetSyp)}
              hint={t('settlement.netHint')}
              tone="net"
            />
          </div>

          {data.orders.length === 0 ? (
            <div className="wh-empty-state">
              <div className="wh-empty-state-title">{t('settlement.noOrders')}</div>
            </div>
          ) : (
            <div className="wh-card table-scroll">
              <table className="wh-table">
                <thead>
                  <tr>
                    <th>{t('settlement.invoice')}</th>
                    <th>{t('settlement.deliveredOn')}</th>
                    <th className="wh-num">{t('settlement.orderSales')}</th>
                    <th className="wh-num">{t('settlement.orderCredited')}</th>
                    <th className="wh-num">{t('settlement.orderCommission')}</th>
                    <th className="wh-num">{t('settlement.orderNet')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((row) => (
                    <tr key={row.orderId}>
                      <td>
                        <div className="wh-table-order-num">
                          {row.invoiceNumber != null
                            ? t('settlement.invoiceNumber', { number: row.invoiceNumber })
                            : '—'}
                        </div>
                        <div className="wh-table-sub">
                          {t('orders.orderNumber', { number: row.orderNumber })}
                        </div>
                      </td>
                      <td className="wh-num">
                        {row.deliveredAt ? new Date(row.deliveredAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="wh-num">{formatSyp(row.salesSyp)}</td>
                      <td className="wh-num">
                        {row.creditedSyp > 0 ? `- ${formatSyp(row.creditedSyp)}` : '—'}
                      </td>
                      <td className="wh-num">
                        {`- ${formatSyp(row.commissionSyp - row.commissionClawbackSyp)}`}
                      </td>
                      <td className="wh-num wh-table-total">{formatSyp(row.warehouseNetSyp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="wh-table-hint">{t('settlement.footnote')}</p>
        </>
      )}
    </div>
  );
}
