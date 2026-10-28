(() => {
  // Commas inside parentheses and separators between alternative documents are not separate requirements.
  function documentItems(text) {
    const items = []; let item = '', depth = 0;
    for (const character of String(text || '')) {
      if ('(（'.includes(character)) depth++;
      if (')）'.includes(character)) depth = Math.max(0, depth - 1);
      if ((character === ',' && !depth) || character === '\n') {
        if (item.trim()) items.push(item.trim());
        item = '';
      } else item += character;
    }
    if (item.trim()) items.push(item.trim());
    return [...new Set(items)];
  }
  function preparationMessage(missing) {
    return missing.length
      ? '아직 체크하지 않은 항목: ' + missing.join(', ') + '. 발급 가능 여부와 준비 방법은 해당 민원의 공식 안내에서 확인해 주세요.'
      : '안내된 항목을 모두 준비했다고 체크했어요. 서류의 유효성이나 신청 자격을 확인한 결과는 아닙니다. 해당 민원의 공식 안내를 마지막으로 확인해 주세요.';
  }
  function historyFor(message, history) {
    let recent=[];
    if (Array.isArray(history)) for (let i=0;i+1<history.length;i+=2) {
      const a=history[i],b=history[i+1];
      if(a?.role==='user' && b?.role==='model' && [a,b].every(turn=>typeof turn.text==='string' && turn.text.trim() && turn.text.length<=4000)) recent.push({role:'user',text:a.text},{role:'model',text:b.text});
    }
    recent=recent.slice(-6);
    while(recent.length && (recent.reduce((n,turn)=>n+turn.text.length,0)>12000 || new TextEncoder().encode(JSON.stringify({query:message,history:recent})).length>19000))recent=recent.slice(2);
    return recent;
  }
  function receiptDestination(search) {
    const params=new URLSearchParams(search);
    const no=(params.get('no') || params.get('q') || '').trim().slice(0,100);
    return '/mypage.html'+(no?'?'+new URLSearchParams({q:no}):'')+'#receipts';
  }
  window.portalGuidance = { documentItems, preparationMessage, historyFor, receiptDestination };
})();
