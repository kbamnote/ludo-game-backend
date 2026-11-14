/**
 * Creates a game.
 *
 * `seed` makes a match reproducible. Pass the match id and the whole game
 * replays identically — which is how a desync gets diagnosed rather than
 * guessed at.
 */
export function createGame({ seats, seed, startingSeat }?: {
    seats?: number[] | undefined;
    seed?: number | undefined;
    startingSeat?: any;
}): {
    seats: any;
    tokens: {
        id: string;
        seat: any;
        slot: number;
        progress: number;
    }[];
    turn: any;
    phase: string;
    roll: null;
    legalMoves: never[];
    consecutiveSixes: number;
    rngState: number;
    rollCount: number;
    winner: null;
    ranking: never[];
};
/**
 * Roll the dice.
 *
 * `forcedValue` exists for the server to replay an authoritative roll and for
 * tests to drive a specific sequence. A client must never pass it in a real
 * match — Phase 5 wires the server as the only caller that may.
 */
export function roll(state: any, { forcedValue }?: {}): {
    state: any;
    events: {
        type: string;
        reason: string;
    }[];
} | {
    state: any;
    events: {
        type: string;
        seat: any;
        value: any;
    }[];
};
/** Move a token. `tokenId` must be one of state.legalMoves. */
export function move(state: any, tokenId: any): {
    state: any;
    events: {
        type: string;
        reason: string;
    }[];
} | {
    state: any;
    events: ({
        type: string;
        seat: any;
        tokenId: any;
        from: any;
        to: any;
        leftHouse: any;
        by?: undefined;
        place?: undefined;
        ranking?: undefined;
    } | {
        type: string;
        by: any;
        tokenId: any;
        seat: any;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        place?: undefined;
        ranking?: undefined;
    } | {
        type: string;
        seat: any;
        tokenId: any;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        by?: undefined;
        place?: undefined;
        ranking?: undefined;
    } | {
        type: string;
        seat: any;
        place: any;
        tokenId?: undefined;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        by?: undefined;
        ranking?: undefined;
    } | {
        type: string;
        ranking: any;
        seat?: undefined;
        tokenId?: undefined;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        by?: undefined;
        place?: undefined;
    })[];
} | {
    state: any;
    events: ({
        type: string;
        seat: any;
        tokenId: any;
        from: any;
        to: any;
        leftHouse: any;
        by?: undefined;
        place?: undefined;
    } | {
        type: string;
        by: any;
        tokenId: any;
        seat: any;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        place?: undefined;
    } | {
        type: string;
        seat: any;
        tokenId: any;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        by?: undefined;
        place?: undefined;
    } | {
        type: string;
        seat: any;
        place: any;
        tokenId?: undefined;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        by?: undefined;
    } | {
        type: string;
        seat: any;
        tokenId?: undefined;
        from?: undefined;
        to?: undefined;
        leftHouse?: undefined;
        by?: undefined;
        place?: undefined;
    })[];
};
/** Restart with the same seats. A fresh seed gives a genuinely new game. */
export function restart(state: any, { seed }?: {}): {
    seats: any;
    tokens: {
        id: string;
        seat: any;
        slot: number;
        progress: number;
    }[];
    turn: any;
    phase: string;
    roll: null;
    legalMoves: never[];
    consecutiveSixes: number;
    rngState: number;
    rollCount: number;
    winner: null;
    ranking: never[];
};
/**
 * Picks a move for a CPU player.
 *
 * Deliberately simple and readable rather than strong: finish > capture >
 * leave the house > furthest along. Phase 7 can tune difficulty; right now
 * the job is to make a single-player game playable and never stall.
 */
export function chooseCpuMove(state: any): any;
/** Summary for the results screen. */
export function summarise(state: any): any;
export namespace Phase {
    let awaitingRoll: string;
    let awaitingMove: string;
    let finished: string;
}
declare namespace _default {
    export { Phase };
    export { createGame };
    export { roll };
    export { move };
    export { restart };
    export { chooseCpuMove };
    export { summarise };
}
export default _default;
