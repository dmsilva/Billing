import { getConferenceState } from "./actions";
import { ConferenceClient } from "./conference-client";

export const dynamic = "force-dynamic";

export default async function ConferenciaPage() {
  const state = await getConferenceState();

  return <ConferenceClient initialState={state} />;
}
