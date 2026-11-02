import { useLastSeenHeartbeat } from '../hooks/usePresence';

export default function PresenceHeartbeat() {
    useLastSeenHeartbeat();
    return null;
}
