import toposort from "./toposort.utils";
import { Transaction } from "../interfaces/electrs.interface";

export function isMobile() {
  return (window.innerWidth <= 767.98);
}

/**
 * Sort an array of transactions in place.
 * @param {Transaction[]} transactions This array of transactions is sorted in place,
 * first unconfirmed by first seen timestamp. Then confirmed by block
 * height descending. If multiple transactions are in the same block,
 * topological sort is used to find a dependency ordering that does
 * not have ie. a deposit coming after the transaction that spends it.
 * @param {boolean} [ascending=false] If true, sort from oldest to newest
 */
export function sortTransactions(
  transactions: Transaction[],
  ascending: boolean = false
): void {
  // Sort as usual, tx with same block will be possibly wrong order
  transactions.sort((a, b) => {
    const x = ascending ? a : b;
    const y = ascending ? b : a;
    if (x.status.confirmed && y.status.confirmed) {
      return x.status.block_height - y.status.block_height;
    } else if (x.status.confirmed || y.status.confirmed) {
      return x.status.confirmed ? -1 : 1;
    } else {
      return x.firstSeen - y.firstSeen;
    }
  });

  // Get ranges of same blocks
  const sameBlockRanges = getSameBlockRanges(transactions);

  // For each range of same-block ranges, topological sort
  for (const [start, end] of sameBlockRanges) {
    sortSameBlockRange(transactions, start, end, ascending);
  }
}

/**
 * Get an array of tuples with start and end (non-inclusive) ranges of same blocks.
 * This function assumes that all confirmed transactions are sorted by block height.
 * @param {Transaction[]} transactions List of transactions
 * @returns {[number, number][]} List of tuples [start, end)
 */
function getSameBlockRanges(transactions: Transaction[]): [number, number][] {
  const sameBlockRanges: [number, number][] = [[null, null]];
  let previousBlockheight = -1;
  transactions.forEach((tx, i) => {
    if (!tx.status.confirmed) {
      return;
    }
    const currentBlockHeight = tx.status.block_height;
    const lastRange = sameBlockRanges[sameBlockRanges.length - 1];
    if (currentBlockHeight !== previousBlockheight) {
      if (lastRange[1] !== null) {
        sameBlockRanges.push([i, null]);
      } else {
        lastRange[0] = i;
      }
    } else {
      // In ranges for slice, end is non-inclusive
      lastRange[1] = i + 1;
    }

    previousBlockheight = currentBlockHeight;
  });
  if (sameBlockRanges[sameBlockRanges.length - 1][1] === null) {
    sameBlockRanges.pop();
  }
  return sameBlockRanges;
}

/**
 * Sort a subarray of a list of transactions where the block height is the same
 * using topological sort. Note: transactions without any dependency on other items
 * in the same block can be in any order (ie. two deposits A and B arriving in the same block
 * might have order B A in one call and A B in another call)
 * @param {Transaction[]} transactions List of transactions modified in place
 * @param {number} start start of the subarray we will sort (inclusive)
 * @param {number} end end of the subarray we will sort (non-inclusive)
 * @param {boolean} ascending if true, sort from oldest to newest (parent to child)
 */
function sortSameBlockRange(
  transactions: Transaction[],
  start: number,
  end: number,
  ascending: boolean
): void {
  const txs = transactions.slice(start, end);
  const txids = txs.map((tx) => tx.txid);
  // We will get a sorted array of txids, this will make it easier
  // to retrieve the Transactions once we're done.
  const txidTxMap = txs.reduce((acc, tx) => {
    acc.set(tx.txid, tx);
    return acc;
  }, new Map<string, Transaction>());
  // Create an array of edges, direction child to parent (child will sort first)
  const edges = txs.reduce(
    (acc, tx) =>
      acc.concat(
        tx.vin.map((vin) =>
          ascending ? [vin.txid, tx.txid] : [tx.txid, vin.txid]
        )
      ),
    [] as [string, string][]
  );
  // Topological sort the edges and give an order that does not conflict
  // with the dependency graph. Filter to only txids in this range.
  const sorted = toposort(edges).filter((txid) => txids.includes(txid));
  // Place the transactions in the correct order.
  sorted.forEach((txid, index) => {
    transactions[start + index] = txidTxMap.get(txid);
  });
}
