import type { Card } from './cards.ts';
import { HAND_NAMES, type EvaluatedHand, type HandCategory } from './evaluator.ts';

export type PokerGlossaryEntry = Readonly<{ term: string; explanation: string; example: string }>;

/** Break-even win probability for a call, ignoring ties and any future betting. */
export function getCallBreakEvenProbability(pot: number, callAmount: number): number {
  if (!Number.isSafeInteger(pot) || pot < 0 || !Number.isSafeInteger(callAmount) || callAmount < 0) {
    throw new RangeError('Pot and call amount must be non-negative safe integers');
  }
  const finalPot = pot + callAmount;
  if (!Number.isSafeInteger(finalPot)) throw new RangeError('Final pot exceeds the safe integer range');
  return finalPot === 0 ? 0 : callAmount / finalPot;
}

export const POKER_GLOSSARY: readonly PokerGlossaryEntry[] = [
  { term: 'プリフロップ', explanation: '共通カードがまだ出ていない最初のベッティングラウンドです。', example: '手札2枚を受け取ったあと、フロップが出る前に行動します。' },
  { term: 'フロップ', explanation: 'テーブル中央に最初に公開される3枚の共通カードです。', example: '自分の手札2枚と合わせ、役の可能性を考えます。' },
  { term: 'ターン', explanation: 'フロップのあとに公開される4枚目の共通カードです。', example: 'ターンのあと、もう一度ベッティングラウンドがあります。' },
  { term: 'リバー', explanation: '最後に公開される5枚目の共通カードです。', example: 'リバー後に残ったプレイヤーはショーダウンへ進みます。' },
  { term: 'ブラインド', explanation: 'カードを見る前に強制的に出すベットです。', example: 'ディーラーボタンの左隣がスモールブラインド、その次がビッグブラインドです。' },
  { term: 'スモールブラインド（SB）', explanation: 'ディーラーボタンの左隣の人が、カードを見る前に強制的に出す少額のベットです。', example: 'ブラインドが5/10なら、スモールブラインドは5チップです。2人で遊ぶときは、ボタンの人がスモールブラインドになります。' },
  { term: 'ビッグブラインド（BB）', explanation: 'スモールブラインドの左隣の人が強制的に出すベットで、プリフロップの最低ベット額になります。', example: 'ブラインドが5/10なら、ビッグブラインドは10チップです。他の人は、まず10チップに合わせるか、レイズするか、フォールドします。' },
  { term: 'アンティ（Ante）', explanation: 'ハンドごとに、参加者全員が最初に出す少額の参加費です。ブラインドより前に集められます。', example: 'アンティが2なら、全員が2チップずつ出してからブラインドが出されます。アンティはポットに入り、ベット額には数えません。残りが足りない人は、あるだけ出してオールインになります。' },
  { term: 'ポジション', explanation: 'ディーラーボタンから見た座る位置です。後に行動できる位置ほど、相手の動きを見てから判断できて有利です。', example: 'ボタン（ディーラー）は、フロップ以降は最後に行動できるため、最も有利な位置とされています。' },
  { term: 'ポットオッズ', explanation: 'コールに必要なチップと、コール後のポットの大きさの比率です。勝つ確率がそれより高ければ、長い目で見て得になります。', example: 'ポット30にコール10が必要なら、10 ÷ (30＋10)＝25%。勝率が25%を超えると見込めるなら、コールは有利です。画面の「必要勝率」がこの値です。' },
  { term: 'ポット', explanation: 'そのハンドで全員が出したチップの合計です。', example: 'ショーダウンの勝者が、対象となるポットを獲得します。' },
  { term: 'チェック', explanation: '追加のチップを出さずに順番を次へ進めます。', example: 'そのラウンドで自分より大きいベットがなければ選べます。' },
  { term: 'コール', explanation: '現在のベット額に合わせるためのチップを出します。', example: '相手が10枚出していて自分が0枚なら、10枚出します。' },
  { term: 'レイズ', explanation: '現在のベット額より多く出して、次のプレイヤーに判断を返します。', example: '現在のベットが10枚のとき、20枚まで上げます。' },
  { term: 'フォールド', explanation: 'そのハンドから降り、すでに出したチップを放棄します。', example: 'これ以上チップを出したくないときに選びます。' },
  { term: 'オールイン', explanation: '自分の残りチップをすべて出します。', example: 'コールに足りない場合も、残り全部を出して参加できます。' },
  { term: 'キッカー', explanation: '同じ組み合わせの役を持つプレイヤー同士で、勝敗を分ける残りのカードです。', example: '同じワンペアなら、ペア以外の高いカードから比べます。' },
  { term: 'サイドポット', explanation: '誰かがオールインしたとき、各自が出した額に応じて分けられる別のポットです。オールインした人は、自分が出した額までのポット（メインポット）だけを争えます。', example: '100・300・300チップを出した3人なら、メインポットは300、サイドポットは400で、サイドポットは300出した2人だけが争います。フォールドした人のチップもポットに残ります。' },
  { term: 'ショーダウン', explanation: '最後まで残ったプレイヤーが手札を比べて勝者を決める段階です。', example: '各自の手札2枚と共通カードから、最も強い5枚を使います。' },
];

const HAND_EXPLANATIONS: Record<HandCategory, string> = {
  0: '5枚に同じ数字の組み合わせがないため、一番高いカードで比べます。',
  1: '同じ数字のカードが2枚あります。残りのカードを高い順に比べます。',
  2: '同じ数字のペアが2組あります。高いペア、低いペア、残りの1枚の順に比べます。',
  3: '同じ数字のカードが3枚あります。残りのカードが同じならキッカーを比べます。',
  4: '数字が5つ連続しています。AはA-2-3-4-5の一番低い数字としても使えます。',
  5: '5枚すべてが同じスートです。数字の高いカードから比べます。',
  6: '同じ数字の3枚組と、別の数字のペアができています。',
  7: '同じ数字のカードが4枚あります。残りの1枚が同じならキッカーを比べます。',
  8: '同じスートで数字が5つ連続しています。',
  9: '同じスートの10、J、Q、K、Aでできた最も強いストレートフラッシュです。',
};

const RANK_LABELS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_LABELS: Record<Card['suit'], string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };

export type HandExplanation = Readonly<{
  name: string;
  category: HandCategory;
  reason: string;
  cards: readonly Readonly<{ card: Card; label: string }>[];
  strengthOrder: number;
}>;

export function explainHand(hand: EvaluatedHand): HandExplanation {
  return {
    name: HAND_NAMES[hand.rank.category],
    category: hand.rank.category,
    reason: HAND_EXPLANATIONS[hand.rank.category],
    cards: hand.cards.map((card) => ({ card, label: `${RANK_LABELS[card.rank]}${SUIT_LABELS[card.suit]}` })),
    strengthOrder: 10 - hand.rank.category,
  };
}

export function findGlossaryEntry(term: string): PokerGlossaryEntry | undefined {
  return POKER_GLOSSARY.find((entry) => entry.term === term);
}
