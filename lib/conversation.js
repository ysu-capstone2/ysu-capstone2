// Only complete conversational messages match. A greeting followed by a real question must still be answered.
export function conversationReply(message) {
  const text = message.normalize('NFKC').toLowerCase().trim().replace(/[ᄒᄋᄏ]/gu, character=>({'ᄒ':'ㅎ','ᄋ':'ㅇ','ᄏ':'ㅋ'}[character])).replace(/[\s.,!?！？。~～…👋😊🙂🙏]+/gu, '');
  if (/^(?:안녕|안녕하세요|안녕하세용|안녕하십니까|하이|헬로|hello|hi|반가워|반가워요|반갑습니다|좋은아침|좋은아침이에요|ㅎㅇ)$/u.test(text)) {
    return { title:'안녕하세요!', answer:'안녕하세요! 행복톡톡이에요. 궁금한 민원이나 불편한 점을 편하게 말씀해 주세요. 예를 들어 “민원 신청은 어디서 하나요?”처럼 물어보실 수 있어요.' };
  }
  if (/^(?:고마워|고마워요|고맙습니다|감사|감사해|감사해요|감사합니다|땡큐|thankyou|thanks)(?:ㅎㅎ|ㅋㅋ)?$/u.test(text)) {
    return { title:'도움이 되었다니 다행이에요', answer:'도움이 되었다니 다행이에요! 더 궁금한 민원이 있으면 편하게 물어보세요.' };
  }
  if (/^(?:잘가|잘가요|안녕히계세요|안녕히가세요|다음에봐|다음에봐요|또봐|또봐요|bye|굿바이)$/u.test(text)) {
    return { title:'다음에 또 만나요', answer:'이용해 주셔서 고마워요. 궁금한 민원이 생기면 언제든 다시 찾아주세요!' };
  }
  if (/^(?:네|넵|넹|예|응|ㅇㅇ|알겠어|알겠어요|알겠습니다|오케이|오케이요|ok|okay)$/u.test(text)) {
    return { title:'계속 도와드릴게요', answer:'네! 추가로 궁금한 점이 있으면 말씀해 주세요.' };
  }
  if (/^(?:너누구야|누구세요|누구야|넌누구니|너는누구야|자기소개|자기소개해줘|뭘할수있어|뭐할수있어|도움말)$/u.test(text)) {
    return { title:'행복톡톡이에요', answer:'행복톡톡은 캡스톤 시연용 민원 안내 도우미예요. 민원 신청 방법과 준비할 정보, 공식 확인 창구를 안내해 드려요. 이 사이트의 상담 예약은 시연용이며 실제 행정기관에 접수되지는 않아요.' };
  }
  return null;
}

export function needsDetails(message) {
  const text = message.normalize('NFKC').trim().replace(/[\s?!？！.。~]+/gu, '');
  return /^(?:민원|민원상담|상담|도와줘|도와주세요|문의|질문|궁금해요|민원있어요|민원이있어요|민원있는데|여권|전입신고|등본|주민등록등본|세금|인감|복지|쓰레기|소음)$/u.test(text);
}

export function wantsHuman(message) {
  const text = message.normalize('NFKC').trim().replace(/[\s?!？！.。~]+/gu, '');
  return /^(?:담당자|전문가|사람|상담원|공무원)(?:와|과|에게|랑)?(?:직접)?(?:상담|연결|상담예약)(?:해줘|해주세요|하고싶어|하고싶어요|할래|할래요|부탁해요|원해요)?$/u.test(text);
}

export function needsContext(message) {
  const text=message.normalize('NFKC').trim().replace(/[\s?!？！.。~]+/gu,'');
  if (/전입|여권|등본|주민등록|인감|세금|도로|소음|쓰레기|복지|민원/u.test(text)) return false;
  return /^(?:그건|그거|그것|이건|이거|아까그|그럼|그러면|그서류|거기)/u.test(text)
    || /^(?:서류|기간|비용|수수료)(?:는|은|가|이)?(?:요|뭐|어떻게|언제|얼마)/u.test(text);
}

export function withoutGreeting(message) {
  return message.trim().replace(/^(?:안녕하세요|안녕하십니까|안녕|hello|hi)(?:[\s,!.~！。]+)(?=\S)/iu, '');
}
