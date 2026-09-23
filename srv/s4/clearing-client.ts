// Adapted from AlexanderX/ts-agentic-poc (Apache-2.0).
// Writes to the S/4 Postings service (zac_posting_moc_o4). Creating a
// Postings record IS the posting action; simulatePosting is the follow-up.
// Requires CASH_S4_ENABLED=true and the destination to exist; the HTTP layer
// is injected so postClearing is unit-testable without hitting the sandbox.

export interface ClearingMatch {
    openItemId: string
    companyCode: string
    amount: number
    currency: string
    customer: string
}

export interface SapMessage {
    code: string
    message: string
    target?: string
    numericSeverity: number
}

// Aligned by index with the input `matches` array.
export interface ClearingResult {
    postingId: string
    documentNumber: string
    status: string
    sapMessages: SapMessage[]
}

interface PostingRecord {
    PostingId: string
    DocumentNumber: string
    Status: string
    SAP__Messages?: SapMessage[]
}

export type HttpPost = (url: string, body: unknown) => Promise<unknown>

async function defaultHttpPost(url: string, body: unknown): Promise<unknown> {
    if (process.env.CASH_S4_ENABLED !== 'true') throw new Error('S/4 posting is disabled. Set CASH_S4_ENABLED=true only after explicit approval.')
    if (!process.env.VCAP_SERVICES) {
        try {
            // @ts-expect-error @sap/xsenv does not bundle type declarations
            const xsenv = (await import('@sap/xsenv')).default
            xsenv.loadEnv()
        } catch {
            // ignore
        }
    }
    const { executeHttpRequest } = await import('@sap-cloud-sdk/http-client')
    const response = await executeHttpRequest(
        { destinationName: process.env.S4_DESTINATION_NAME ?? 'HD0_BAS' },
        { method: 'post', url, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, data: body, timeout: 30000 },
    )
    return response.data
}

export async function postClearing(
    matches: ClearingMatch[],
    httpPost: HttpPost = defaultHttpPost,
): Promise<ClearingResult[]> {
    const results: ClearingResult[] = []

    for (const match of matches) {
        const created = (await httpPost(POSTING_PATH, {
            OpenItemId: match.openItemId,
            company_code: match.companyCode,
            Amount: match.amount,
            Currency: match.currency,
            Customer: match.customer,
        })) as PostingRecord

        // Edm.Guid keys are unquoted in the URL (unlike Edm.String keys).
        const simulated = (await httpPost(
            `${POSTING_PATH}(${created.PostingId})/${POSTING_NAMESPACE}.simulatePosting`,
            {},
        )) as PostingRecord

        results.push({
            postingId: simulated.PostingId,
            documentNumber: simulated.DocumentNumber,
            status: simulated.Status,
            sapMessages: simulated.SAP__Messages ?? [],
        })
    }

    return results
}

const POSTING_PATH =
    '/sap/opu/odata4/sap/zac_posting_moc_o4/srvd_a2x/sap/zac_posting_moc/0001/Postings'
const POSTING_NAMESPACE = 'com.sap.gateway.srvd_a2x.zac_posting_moc.v0001'
