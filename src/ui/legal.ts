import { node } from './dom.ts';
import { SITE_NAME, siteFooter, siteHeader, type SitePage } from './header.ts';

/**
 * Draft legal documents. Every statement about data handling is derived from what the code and Supabase
 * schema in this repository actually do. Items that cannot be known from the code are rendered as an
 * left out rather than invented.
 */
export const LEGAL_UPDATED = '2026年10月23日';

type Section = Readonly<{ id: string; title: string; body: readonly string[] }>;
type LegalDoc = Readonly<{ eyebrow: string; title: string; lead: string; sections: readonly Section[] }>;

const TERMS: LegalDoc = {
  eyebrow: 'TERMS OF SERVICE',
  title: '利用規約',
  lead: `この規約は、astro-root（以下「運営者」）が提供する「${SITE_NAME}」（以下「本サービス」）の利用条件を定めるものです。本サービスを利用した時点で、この規約に同意したものとみなします。`,
  sections: [
    { id: 'overview', title: '第1条（サービスの概要）', body: [
      '本サービスは、テキサスホールデムをブラウザ上で楽しむためのゲームです。AIとの対戦と、招待リンクで集まった友人とのオンライン対戦を提供します。',
      '本サービスのご利用にあたり、運営者が独自に管理するアカウントの登録は求めていません。オンライン対戦では、ブラウザごとに匿名のゲストIDが自動的に作成されます（詳細はプライバシーポリシーをご覧ください）。',
    ] },
    { id: 'chips', title: '第2条（バーチャルチップ）', body: [
      '本サービスで使用するチップは、ゲーム内でのみ有効なバーチャルチップです。',
      '本サービスは、現金その他の金銭的価値のあるものを賭ける機能、チップを現金・商品・その他の価値と交換する機能、賞金を提供する機能を備えていません。運営者はそのようなサービスを提供しません。',
      'ユーザー同士で、本サービスのゲーム結果を金銭の授受その他の賭けの対象にすることを禁止します。',
    ] },
    { id: 'rooms', title: '第3条（表示名・ルーム・招待リンク）', body: [
      '表示名は、他の参加者に表示されます。個人を特定できる情報、他者を誹謗中傷する内容、公序良俗に反する名称は使用しないでください。表示名は自分自身の分のみ変更できます。',
      'ルームは、作成者（ホスト）が招待リンクを共有した相手が参加できます。招待リンクを知っている人は誰でもそのルームに参加または観戦できるため、共有先はホスト自身の責任で選んでください。',
      'ルームの設定（初期スタック、ハンド数、ブラインド、アンティなど）を変更できるのはホストのみです。対戦中の変更は次のハンドから反映され、初期スタックは開始後に変更できません。観戦者はゲームの操作を行えません。',
      'ホストは、ルームの参加者や観戦者を退場させることができます。退場させられた人は、そのルームに戻れません。ルームには、短いルームコードが付与されます。コードや招待リンクを知っている人は参加できるため、共有先にご注意ください。',
      '一定期間操作のないルームは、予告なく削除されることがあります。',
    ] },
    { id: 'prohibited', title: '第4条（禁止行為）', body: [
      '次の行為を禁止します。',
      '・本サービス、サーバー、ネットワークへの攻撃、過大な負荷を与える行為（自動化されたリクエストの大量送信を含みます）。',
      '・不具合や脆弱性を悪用する行為、認証・権限・レート制限などの仕組みを回避しようとする行為。',
      '・複数のゲストIDを使った不正な共謀、他の参加者の手札を知ろうとする行為など、ゲームの公平性を損なう行為。',
      '・チャットや表示名での迷惑行為、嫌がらせ、なりすまし、他のユーザーへの不快な内容の送信。',
      '・法令または公序良俗に反する行為、その他運営者が不適切と判断する行為。',
    ] },
    { id: 'measures', title: '第5条（利用制限・不正行為への対応）', body: [
      '運営者は、前条に該当する、またはそのおそれがあると判断した場合、事前の通知なく、ルームの削除、アクセスの制限その他必要な措置をとることがあります。',
    ] },
    { id: 'changes', title: '第6条（サービスの変更・停止・終了）', body: [
      '運営者は、保守、障害対応、外部サービスの変更その他の理由により、本サービスの全部または一部を、事前の通知なく変更、停止、終了することがあります。',
      '本サービスは、AI対戦の履歴などを利用者のブラウザ内に保存します。ブラウザのデータ消去や端末の変更により、これらは失われる場合があります。',
    ] },
    { id: 'disclaimer', title: '第7条（免責・責任の範囲）', body: [
      '本サービスは、現状のまま提供されます。運営者は、本サービスが中断なく動作すること、不具合がないこと、ゲームの結果や通信の遅延がないことを保証しません。',
      'ゲーム内のチップの増減、対戦の中断、データの消失について、運営者は、運営者に故意または重大な過失がある場合を除き、責任を負いません。',
      '前項の定めにかかわらず、法令により運営者が責任を負うべき場合には、その範囲で責任を負います。',
    ] },
    { id: 'revision', title: '第8条（規約の変更）', body: [
      '運営者は、必要に応じて本規約を変更することがあります。変更後の規約は、本ページに掲載した時点から効力を生じます。重要な変更がある場合は、本サービス上でお知らせします。',
    ] },
    { id: 'law', title: '第9条（準拠法・紛争の解決）', body: [
      '本規約の解釈には、日本法を準拠法とします。',
    ] },
    { id: 'contact', title: '第10条（運営者・お問い合わせ）', body: [
      '運営者名：Root（astro-root）',
      '親サイト：https://astro-root.com',
      'お問い合わせ先：https://astro-root.com/contact',
    ] },
  ],
};

const PRIVACY: LegalDoc = {
  eyebrow: 'PRIVACY POLICY',
  title: 'プライバシーポリシー',
  lead: `astro-root（以下「運営者」）は、「${SITE_NAME}」（以下「本サービス」）で取り扱う情報について、実際の仕組みに基づき、以下のとおり説明します。`,
  sections: [
    { id: 'collected', title: '1. 取得する情報', body: [
      '本サービスは、アカウント登録のためのメールアドレス、氏名、住所、電話番号、支払い情報を取得しません。',
      'オンライン対戦を利用する場合、次の情報が取得・保存されます。',
      '・匿名のゲストID：ブラウザごとに自動的に作成される識別子です（Supabase Authの匿名ログイン機能を使用）。',
      '・表示名：ご自身が入力した名前です。',
      '・ルームの状態：参加者と観戦者の一覧、ルームコード、ゲーム設定、配られたカード、チップ、各プレイヤーの操作の記録、在席の最終確認時刻、ホストが退場させた参加者のID、チャットのメッセージ（直近30件まで）など、ゲームの進行に必要な情報です。チャットは同じルームの参加者・観戦者に表示されます。',
      '・利用頻度の制限のための記録：ゲストID、操作の種類ごとの回数と時刻です。',
      'AI対戦のみを利用する場合、ゲームの進行は利用者のブラウザ内で処理されます。',
    ] },
    { id: 'method', title: '2. 取得方法', body: [
      '入力された表示名や操作は、本サービスの画面から送信されます。ゲストIDや在席情報などは、本サービスの利用に伴い自動的に取得されます。',
    ] },
    { id: 'purpose', title: '3. 利用目的', body: [
      '・オンライン対戦の提供（参加者の識別、ゲーム進行、手札の本人への表示、観戦の制御）。',
      '・不正利用の防止、過大な負荷の防止（利用頻度の制限）。',
      '・不具合の調査とサービスの改善。',
    ] },
    { id: 'storage', title: '4. 保存する情報と保存期間', body: [
      'ルームの状態：終了したルームは、最後の更新から約1時間、未終了のルームは約24時間を過ぎると削除の対象になります。削除処理は、ルームの作成などの操作をきっかけに実行されるため、実際の削除時刻は前後することがあります。',
      '利用者のブラウザ内には、次の情報が保存されます（運営者のサーバーには送信されません）：ログイン状態（Supabaseのセッション）、表示名、AI対戦の設定、AI対戦の直近のハンド履歴（最大10件）。ブラウザの設定から削除できます。',
    ] },
    { id: 'vendors', title: '5. 外部サービスによる処理', body: [
      'Supabase：匿名認証、データベース、オンライン対戦の処理（Edge Functions）に使用します。上記の情報がSupabaseのサーバーで処理・保存されます。',
      'Vercel：本サービスのウェブサイトの配信に使用します。一般的な配信の仕組みとして、アクセス元のIPアドレス、ブラウザ・端末の情報、アクセス日時などがログとして処理される場合があります。',
      '本サービスのフォントは、サービス自身から配信されており、外部のフォント配信サービスを利用していません。',
    ] },
    { id: 'cookies', title: '6. Cookie・ローカルストレージ・アクセス解析', body: [
      '本サービスのプログラムは、Cookieを設定しません。ブラウザのローカルストレージを、第4条に記載した目的で使用します。',
      '本サービスのプログラムには、アクセス解析ツールや広告の仕組みは含まれていません。今後導入する場合は、導入前に本ポリシーを更新します。',
      'ホスティングや認証の基盤側の仕組みについては、各社のポリシーをご確認ください。',
    ] },
    { id: 'logs', title: '7. ログ・IPアドレス・端末情報', body: [
      '本サービスのプログラムは、IPアドレスやブラウザ情報を独自に保存していません。ただし、上記の外部サービスにおいて、運用上のログとして記録される場合があります。',
      '利用頻度の制限は、IPアドレスではなくゲストIDを基準に行っています。',
    ] },
    { id: 'sharing', title: '8. 第三者提供・委託', body: [
      '運営者は、法令に基づく場合を除き、取得した情報を第三者に提供しません。第5条の外部サービスは、本サービスの提供のために情報の処理を委託している先です。',
      '表示名とゲーム内の操作は、同じルームの参加者・観戦者に表示されます。',
    ] },
    { id: 'security', title: '9. 安全管理', body: [
      '実際に行っている主な対策は次のとおりです。',
      '・通信はHTTPSで行われ、サイトはHSTSを設定しています。',
      '・ゲームの進行と手札は、サーバー側で管理されます。手札は本人にのみ送信され、観戦者や他のプレイヤーには、ルール上公開される場合（ショーダウン）を除いて送信されません。',
      '・ルームのデータベースのテーブルは、利用者のブラウザから直接アクセスできない設定になっており、サーバー（Edge Function）経由でのみ操作されます。',
      '・操作の頻度に上限を設けています。',
      '完全な安全を保証するものではありません。',
    ] },
    { id: 'requests', title: '10. 開示・訂正・削除などの請求', body: [
      '保存されている情報の開示、訂正、削除などをご希望の場合は、下記の窓口にご連絡ください。情報は匿名のゲストIDで保存されているため、ゲストIDなどを確認できない場合は、該当の情報を特定できないことがあります。',
      '請求への対応は、法令の定めに従って行います。',
    ] },
    { id: 'changes', title: '11. ポリシーの変更', body: [
      '運営者は、必要に応じて本ポリシーを変更します。変更後の内容は、本ページに掲載した時点から効力を生じます。',
    ] },
    { id: 'contact', title: '12. 運営者・お問い合わせ', body: [
      '運営者名：Root（astro-root）',
      '親サイト：https://astro-root.com',
      'お問い合わせ先：https://astro-root.com/contact',
    ] },
  ],
};

/** Plain text with any https:// address turned into a safe external link (built with DOM nodes, never innerHTML). */
function paragraphNode(text: string): HTMLElement {
  const p = node('p', '');
  for (const part of text.split(/(https:\/\/[^\s）)]+)/u)) {
    if (/^https:\/\//u.test(part)) {
      const link = node('a', 'legal-link', part) as HTMLAnchorElement;
      link.href = part; link.target = '_blank'; link.rel = 'noopener noreferrer';
      p.append(link);
    } else if (part) p.append(document.createTextNode(part));
  }
  return p;
}

export function renderLegalPage(app: HTMLElement, page: Extract<SitePage, 'terms' | 'privacy'>): void {
  const doc = page === 'terms' ? TERMS : PRIVACY;
  document.title = `${doc.title} — ${SITE_NAME}`;
  const shell = node('div', 'page-shell');
  shell.append(siteHeader(page));
  const main = node('main', 'content legal');
  const intro = node('section', 'content-intro');
  intro.append(node('span', 'eyebrow', doc.eyebrow), node('h1', 'page-title', doc.title), node('p', 'page-lead', doc.lead),
    node('p', 'legal-date', `最終更新日：${LEGAL_UPDATED}`));
  main.append(intro);

  const toc = node('nav', 'legal-toc');
  toc.setAttribute('aria-label', '目次');
  toc.append(node('h2', 'legal-toc-title', '目次'));
  const list = node('ol', 'legal-toc-list is-plain');
  for (const section of doc.sections) {
    const item = node('li');
    const link = node('a', '', section.title) as HTMLAnchorElement;
    link.href = `#${section.id}`;
    item.append(link);
    list.append(item);
  }
  toc.append(list);
  main.append(toc);

  const body = node('div', 'legal-body');
  for (const section of doc.sections) {
    const article = node('section', 'legal-section');
    article.id = section.id;
    article.append(node('h2', 'legal-heading', section.title));
    for (const paragraph of section.body) article.append(paragraphNode(paragraph));
    body.append(article);
  }
  main.append(body);
  shell.append(main, siteFooter());
  app.replaceChildren(shell);
}
