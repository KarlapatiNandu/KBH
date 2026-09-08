/**
 * Module 3 — Participant Module
 * Barrel exports for participant identification + the post-login network gate.
 */

export { default as ParticipantHome } from './ParticipantHome';
export { default as NetworkCheck } from './NetworkCheck';
export {
  getStoredParticipant,
  storeParticipant,
  clearStoredParticipant,
  hasCompletedNetworkCheck,
  markNetworkCheckComplete,
  clearNetworkCheck,
} from './storage';
