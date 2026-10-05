import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Northstar's help articles, written the way a small roaster would write
 * them. They are saved as pending; the API's knowledge worker indexes them on
 * its next start (that needs GEMINI_API_KEY).
 */
const ARTICLES: { title: string; content: string }[] = [
  {
    title: 'Shipping',
    content: `# Shipping

We roast on Mondays, Wednesdays and Fridays and ship the same afternoon. Orders placed by 11am Central go out with the next roast; most leave our Austin roastery within 2 business days.

## Carriers and delivery times
- US orders ship with UPS Ground: 2 to 5 business days.
- Orders over $45 ship free in the US. Below that, shipping is a flat $6.
- Every order gets a tracking number by email as soon as the label is printed.

## International
We ship to Canada and the United Kingdom with USPS Priority Mail International (6 to 12 business days). Customs duties and import taxes are paid by the customer when the parcel arrives. We do not ship to the EU right now.

## Late or missing parcels
If tracking has not moved for 5 business days, write to us and we will open a claim with the carrier and send a replacement once the claim is filed. A parcel marked delivered that you cannot find: check with neighbours first, then contact us within 7 days.`,
  },
  {
    title: 'Returns and refunds',
    content: `# Returns and refunds

## Unopened coffee
Unopened bags can be returned within 30 days of delivery for a full refund to the original payment method. Send us your order number and we will email a prepaid return label.

## Opened coffee
We cannot take back opened coffee, but if a bag tasted wrong (stale, too dark, not what you expected) tell us. We will replace it or refund it; we would rather hear about it than lose you.

## Equipment and merchandise
Grinders, kettles and merch (hoodies, mugs) can be returned unused within 30 days. Return shipping for these is paid by the customer unless the item arrived damaged.

## Refund timing
Refunds are issued the day the return arrives and take 3 to 5 business days to show on your card.`,
  },
  {
    title: 'Subscriptions',
    content: `# Subscriptions

A subscription sends fresh coffee every 2 or 4 weeks and saves 10% on every bag.

## Changing or pausing
You can skip a delivery, swap coffees, change the grind or pause for up to 3 months from your account page. Changes made before 9am on the day before your roast date apply to the next shipment.

## Cancelling
Cancel any time from your account page. There is no fee and no minimum number of deliveries. If a shipment has already been roasted it will still ship.

## Gifting
Gift subscriptions are prepaid for 3, 6 or 12 months and do not renew automatically.`,
  },
  {
    title: 'Brewing guide',
    content: `# Brewing guide

## Ratio
Start with 60 grams of coffee per litre of water (about 1:16). Stronger: 1:15. Lighter: 1:17.

## Grind
- Espresso: fine, like table salt.
- Pour over (V60, Kalita): medium-fine.
- Drip machine: medium.
- French press and cold brew: coarse, like breadcrumbs.

## Water
Use water just off the boil, around 93 to 96°C. Filtered water makes a noticeable difference.

## Cold brew
Use a coarse grind, 1 part coffee to 8 parts cold water, steep 16 to 18 hours in the fridge, then filter. Dilute 1:1 with water or milk.

## Which coffee is least acidic?
Our Brazil Cerrado and the Sumatra are the lowest in acidity, with chocolate and nutty notes. Cold brew also tastes less acidic than hot brewing.`,
  },
  {
    title: 'Wholesale',
    content: `# Wholesale

We roast for cafés, offices and restaurants.

- Minimum order: 10 bags of 2 lb (or 5 kg) per delivery.
- Pricing starts at $14 per lb and drops at 50 lb a month.
- Invoices are payable within 30 days (net 30) once the first order is paid.
- We include a free brewing calibration visit for cafés in Austin.

To start, email wholesale@northstarcoffee.co with your business name, address and expected monthly volume.`,
  },
];

/** Idempotent: does nothing once the workspace has any knowledge. */
export async function seedDemoKnowledge(prisma: PrismaClient, organizationId: string) {
  if ((await prisma.knowledgeSource.count({ where: { organizationId } })) > 0) {
    return { sources: 0 };
  }
  await prisma.knowledgeSource.createMany({
    data: ARTICLES.map((a) => ({ organizationId, type: 'TEXT' as const, ...a })),
  });
  return { sources: ARTICLES.length };
}
