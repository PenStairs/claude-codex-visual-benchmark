const RATE_FIELDS = ['input', 'cachedInput', 'cacheWriteInput', 'output'];

function money(value) {
  return Number(value.toFixed(8));
}

function unavailable(reason, pricing = null) {
  return {
    status: 'unavailable',
    type: 'list-price-estimate',
    pricingStrategy: 'lowest-published-rate',
    amount: null,
    currency: pricing?.currency ?? null,
    actualCharge: false,
    reason,
    source: pricing ? {
      label: pricing.sourceLabel,
      url: pricing.sourceUrl,
      checkedAt: pricing.checkedAt,
    } : null,
  };
}

function validateRates(rates) {
  return rates && RATE_FIELDS.every((field) => Number.isFinite(rates[field]) && rates[field] >= 0);
}

function lowestRatePlan(plans) {
  return plans.reduce((lowest, candidate) => {
    if (!lowest) return candidate;
    const candidateTotal = RATE_FIELDS.reduce((sum, field) => sum + candidate.rates[field], 0);
    const lowestTotal = RATE_FIELDS.reduce((sum, field) => sum + lowest.rates[field], 0);
    return candidateTotal < lowestTotal ? candidate : lowest;
  }, null);
}

function resolveRatePlan(pricing, timestamp) {
  const schedule = pricing.schedule;
  if (!schedule || !timestamp) return null;
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return null;
  if (pricing.reviewAfter && instant.getTime() > new Date(pricing.reviewAfter).getTime()) return null;

  if (schedule.type === 'fixed') {
    return validateRates(schedule.rates) ? { planId: schedule.planId, rates: schedule.rates } : null;
  }
  if (schedule.type === 'weekly-utc') {
    if (schedule.selection === 'lowest') {
      return lowestRatePlan([
        { planId: schedule.peakPlanId, rates: schedule.peakRates },
        { planId: schedule.offPeakPlanId, rates: schedule.offPeakRates },
      ]);
    }
    const weekday = instant.getUTCDay();
    const minute = instant.getUTCHours() * 60 + instant.getUTCMinutes();
    const peak = schedule.peakWeekdays.includes(weekday)
      && schedule.peakWindows.some((window) => minute >= window.startMinute && minute < window.endMinute);
    const rates = peak ? schedule.peakRates : schedule.offPeakRates;
    return validateRates(rates) ? {
      planId: peak ? schedule.peakPlanId : schedule.offPeakPlanId,
      rates,
    } : null;
  }
  if (schedule.type === 'periods') {
    if (schedule.selection === 'lowest') {
      return lowestRatePlan(schedule.periods
        .filter((period) => validateRates(period.rates))
        .map((period) => ({ planId: period.planId, rates: period.rates })));
    }
    const period = schedule.periods.find((candidate) => {
      const startsOk = !candidate.startsAt || instant.getTime() >= new Date(candidate.startsAt).getTime();
      const endsOk = !candidate.endsAtExclusive || instant.getTime() < new Date(candidate.endsAtExclusive).getTime();
      return startsOk && endsOk;
    });
    return period && validateRates(period.rates) ? { planId: period.planId, rates: period.rates } : null;
  }
  return null;
}

function tokenBreakdown(usage) {
  const inputTokens = usage.input_tokens;
  const cachedInputTokens = usage.cached_input_tokens;
  const cacheWriteInputTokens = usage.cache_write_input_tokens;
  const outputTokens = usage.output_tokens;
  if (![inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens]
    .every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  const regularInputTokens = inputTokens - cachedInputTokens - cacheWriteInputTokens;
  if (regularInputTokens < 0) return null;
  return { regularInputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens };
}

function priceBreakdown(tokens, rates, unitTokens) {
  const regularInputAmount = tokens.regularInputTokens * rates.input / unitTokens;
  const cachedInputAmount = tokens.cachedInputTokens * rates.cachedInput / unitTokens;
  const cacheWriteInputAmount = tokens.cacheWriteInputTokens * rates.cacheWriteInput / unitTokens;
  const outputAmount = tokens.outputTokens * rates.output / unitTokens;
  return {
    regularInput: { tokens: tokens.regularInputTokens, pricePerMillionTokens: rates.input, amount: money(regularInputAmount) },
    cachedInput: { tokens: tokens.cachedInputTokens, pricePerMillionTokens: rates.cachedInput, amount: money(cachedInputAmount) },
    cacheWriteInput: { tokens: tokens.cacheWriteInputTokens, pricePerMillionTokens: rates.cacheWriteInput, amount: money(cacheWriteInputAmount) },
    output: { tokens: tokens.outputTokens, pricePerMillionTokens: rates.output, amount: money(outputAmount) },
    amount: regularInputAmount + cachedInputAmount + cacheWriteInputAmount + outputAmount,
  };
}

export function estimateListPrice(model, executions = []) {
  const pricing = model.pricing;
  if (!pricing) return unavailable(`No verified public list-price configuration exists for model ${model.model}.`);
  if (!executions.length) return unavailable('No completed creative or repair execution is available to price.', pricing);

  const runnerEstimates = executions.map((execution) => execution.usage?.estimated_cost_usd);
  const runnerReportedEstimate = runnerEstimates.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ? {
      amount: money(runnerEstimates.reduce((sum, value) => sum + value, 0)),
      currency: 'USD',
      usedForCalculation: false,
    }
    : null;

  const phases = [];
  let total = 0;
  for (const execution of executions) {
    if (!execution.usage || execution.usage.complete !== true) {
      return unavailable(`Token usage is missing or incomplete for phase ${execution.phase}.`, pricing);
    }
    const tokens = tokenBreakdown(execution.usage);
    if (!tokens) return unavailable(`Token usage is internally inconsistent for phase ${execution.phase}.`, pricing);
    const ratePlan = resolveRatePlan(pricing, execution.startedAt);
    if (!ratePlan) {
      const stale = pricing.reviewAfter && new Date(execution.startedAt).getTime() > new Date(pricing.reviewAfter).getTime();
      return unavailable(stale
        ? `The configured public price requires review after ${pricing.reviewAfter}.`
        : `No public rate plan covers phase ${execution.phase} at ${execution.startedAt}.`, pricing);
    }
    const breakdown = priceBreakdown(tokens, ratePlan.rates, pricing.unitTokens);
    total += breakdown.amount;
    phases.push({
      phase: execution.phase,
      startedAt: execution.startedAt,
      ratePlan: ratePlan.planId,
      amount: money(breakdown.amount),
      breakdown: {
        regularInput: breakdown.regularInput,
        cachedInput: breakdown.cachedInput,
        cacheWriteInput: breakdown.cacheWriteInput,
        output: breakdown.output,
      },
    });
  }

  return {
    status: 'estimated',
    type: 'list-price-estimate',
    amount: money(total),
    currency: pricing.currency,
    actualCharge: false,
    definition: 'Actual runner-reported tokens for creative and repair rounds multiplied by the lowest configured public API list price for each token category.',
    calculationMethod: 'token-usage-times-lowest-public-list-price',
    pricingStrategy: 'lowest-published-rate',
    scope: 'creative-and-repair-rounds-only',
    source: { label: pricing.sourceLabel, url: pricing.sourceUrl, checkedAt: pricing.checkedAt },
    notes: pricing.notes,
    runnerReportedEstimate,
    phases,
    excludedFromActualCharge: ['preflight', 'subscription allocation', 'account discounts', 'credits', 'billing adjustments', 'taxes', 'unreported paid tool calls'],
  };
}

export function selfTestPricing() {
  const fixedModel = {
    model: 'probe',
    provider: { id: 'probe' },
    pricing: {
      currency: 'USD',
      unitTokens: 1_000_000,
      sourceLabel: 'probe',
      sourceUrl: 'https://example.com/pricing',
      checkedAt: '2026-09-03',
      notes: [],
      schedule: {
        type: 'fixed',
        planId: 'standard',
        rates: { input: 4, cachedInput: 0.4, cacheWriteInput: 5, output: 20 },
      },
    },
  };
  const result = estimateListPrice(fixedModel, [{
    phase: 'prompt-round-1',
    startedAt: '2026-09-03T00:00:00.000Z',
    usage: {
      complete: true,
      input_tokens: 1_000_000,
      cached_input_tokens: 200_000,
      cache_write_input_tokens: 100_000,
      output_tokens: 100_000,
    },
  }]);
  if (result.status !== 'estimated' || result.amount !== 5.38 || result.phases[0].ratePlan !== 'standard') {
    throw new Error('List-price estimator self-test failed.');
  }

  const weeklyModel = {
    ...fixedModel,
    pricing: {
      ...fixedModel.pricing,
      schedule: {
        type: 'weekly-utc',
        selection: 'lowest',
        peakPlanId: 'peak',
        offPeakPlanId: 'off-peak',
        peakWeekdays: [1, 2, 3, 4, 5],
        peakWindows: [{ startMinute: 60, endMinute: 240 }],
        peakRates: { input: 2, cachedInput: 2, cacheWriteInput: 2, output: 2 },
        offPeakRates: { input: 1, cachedInput: 1, cacheWriteInput: 1, output: 1 },
      },
    },
  };
  const usage = {
    complete: true,
    input_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
  };
  const weekly = estimateListPrice(weeklyModel, [
    { phase: 'peak', startedAt: '2026-09-03T02:00:00.000Z', usage },
    { phase: 'off-peak', startedAt: '2026-09-03T05:00:00.000Z', usage },
  ]);
  if (weekly.amount !== 2 || weekly.phases[0].ratePlan !== 'off-peak' || weekly.phases[1].ratePlan !== 'off-peak') {
    throw new Error('Weekly list-price schedule self-test failed.');
  }

  const periodModel = {
    ...fixedModel,
    pricing: {
      ...fixedModel.pricing,
      schedule: {
        type: 'periods',
        selection: 'lowest',
        periods: [
          { planId: 'promo', endsAtExclusive: '2026-09-09T16:00:00Z', rates: { input: 1, cachedInput: 1, cacheWriteInput: 1, output: 1 } },
          { planId: 'standard', startsAt: '2026-09-09T16:00:00Z', rates: { input: 2, cachedInput: 2, cacheWriteInput: 2, output: 2 } },
        ],
      },
    },
  };
  const periods = estimateListPrice(periodModel, [
    { phase: 'promo', startedAt: '2026-09-09T15:59:59.000Z', usage },
    { phase: 'standard', startedAt: '2026-09-09T16:00:00.000Z', usage },
  ]);
  if (periods.amount !== 2 || periods.phases[0].ratePlan !== 'promo' || periods.phases[1].ratePlan !== 'promo') {
    throw new Error('Period list-price schedule self-test failed.');
  }
  return { fixed: result, weekly, periods };
}
