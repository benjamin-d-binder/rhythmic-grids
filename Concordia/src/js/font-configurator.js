var _int = function(pStr) { return parseInt(pStr, 10); }

function getAvailableSystemFonts() {
  detective = new FontDetector();  // (c) Lalit Patel [see /js/font-detector.js]
  // alternative (wierd) detection via ComicSans (?) [see /js/font-detector-temp.js]
  // font.setup();

  var fontList = getFontList(),
      availableFonts = [];

  fontList.forEach(function(fontName){
    // console.log("%s: %s", fontName, detective.detect(fontName) );
    if (detective.detect(fontName)){
      availableFonts.push(fontName);
    }
  });

  console.log('Available system fonts %s/%s  [%s>%s^]', 
    availableFonts.length, fontList.length, "main", arguments.callee.name);
  return availableFonts;
};


/////////////////////////////////////////////////////////////////////////////

// font selection event handler
// TOFIX called too many times
function onFontChange(e) {
  var id = $(this).attr('id'),  // curr element id (typeface OR font size OR line height)
      lhEl = $('#input-lineheight'),
      fsEl = $('#input-fontsize');
  // console.log("onChange: %s %s", id, this.value );

  // remember selections between sessions
  localStorage.setItem(id, this.value);

  // update text sample according to the selected item
  switch(id){
  case 'fontSelect':
    $('.example-text').css('font-family', this.value+",monospace"); //fallback: Helvetica,Arial,monospace
    $('.text').css('font-family', this.value+",monospace");
    metricsContext.curr_typeface = this.value; // global var for metrics drawing

    // re-draw font metrics
    drawMetrics();
    drawText();
    break;

  case 'input-fontsize':
      lhEl.val( Math.round(_LHFS_R*_int(this.value)) + 'px');
      $('.example-text').css('font-size', _int(this.value)+'px');
      $('.example-text').css('line-height', _int(lhEl.val())+'px');
      $('.text').css('font-size', parseInt(this.value)+'px');
      break;

  case 'input-lineheight':
      _LHFS_R = _int(this.value) / _int( fsEl.val() ); // _LineHeight-FontSize ratio
      $('.example-text').css('line-height', _int(this.value)+'px');
      break;
  }

  var lh = _int($('#input-lineheight').val());

  // if line height IS divisible by 2 or by 3
  if (lh%2==0 || lh%3==0) {
    _LHBL_F = lh%2 ? 3 : 2;

    // ENABLE all radios and restore previous value, if switched from bad line height
    // if (lhEl.css('background-color') {
      lhEl.css('background-color', '');
      if (allConfigs){
        allConfigs.radioForms.each( function(_, el){
          $('input', el).each(function(){
            $(this).prop('disabled', false);
            var prevSelection = localStorage.getItem($(el).attr('id')),
                selector = prevSelection ? 'input[value="'+prevSelection+'"]' : 'input:first';
            $(selector, el).prop('checked', true);
          });
        });

        // select baseline corresponding to line height (div2/3)
        $('#gridBaseline > input[value='+lh/_LHBL_F+']').prop('checked', true);
        allConfigs.radioForms.eq(0).trigger('change');
      } // <-- if (allConfigs)
      resetBaselineSelections();

    // }  // <-- if .css('background-color')

  } else {
    _LHBL_F = lh/lh; //implicit 1
    lhEl.css('background-color', 'lightpink');
    
    // DISABLE all radios and deselect all and clear grid
    if (allConfigs){
      allConfigs.gridContainer.empty();
      allConfigs.radioForms.each( function(_, el){
        if ($('input:checked', $(el)).val())
          localStorage.setItem($(el).attr('id'), $('input:checked', $(el)).val());
        $('input', el).each(function(){  $(this).prop('disabled', true).val([]); });
      });
    }
  }
  console.log("line height: %d; baseline: %d  [%s$]", lh, lh/_LHBL_F, arguments.callee.name);


  $('#lineheight-percent-label').text( 
    Math.round( _int(lhEl.val())/_int(fsEl.val() ) *100) + '%'
  );

};

/////////////////////////////////////////////////////////////////////////////

// set baseline selection valid only for meaningful lineheight values
// callen by onLineHeightChange
function resetBaselineSelections(){
    var blEl = $('#gridBaseline'), // baseline form
        fsVal = _int($('#input-fontsize').val()), // font size
        lhVal = _int($('#input-lineheight').val()),
        lhMin = Math.round(fsVal * allConfigs.lineHeightLimit.min), // line height
        lhMax = Math.round(fsVal * allConfigs.lineHeightLimit.max), // line height
        blRange = [], // baseline
        labelStr = 'gridBaseline'; 

    for (var lh = lhMin; lh<=lhMax; lh++){
        if (lh % _LHBL_F == 0){
            blRange.push(lh/_LHBL_F);
        }
    }
    console.log('factor: %s, baselines: %s  [%s>%s^] ', _LHBL_F, blRange.join(', '), arguments.callee.caller.name, arguments.callee.name);

    blEl.empty();
    blRange.forEach(function(value,i){
        var input = $('<input>').prop({
                type: "radio",
                id: labelStr+String(value),
                name: labelStr,
                value: value
            });
        
        // select recommended baseline (divisible by factor 2 or 3)
        if (value*_LHBL_F == lhVal) 
          input.prop('checked', true); 

        var label = $('<label>').prop('for', labelStr+value).text(value);

        blEl.append(input).append(label);
    });

    return ;
}

////////////////////////////////////////////////////////////////////////////////



function onKeyDown(e) {
    var input = $(e.target),
        val = _int(input.val()),
        code = (e.which || e.keyCode),
        limit = null;

    if (input.attr('id') === 'input-fontsize')
        limit = allConfigs.fontSizeLimit;

    if (input.attr('id') === 'input-lineheight'){
        var fsVal = _int($('#input-fontsize').val());
        limit = { min: Math.round(fsVal*allConfigs.lineHeightLimit.min),
                  max: Math.round(fsVal*allConfigs.lineHeightLimit.max) };
    }

    // [uparrow,downarrow,enter] keys
    if ([38,40,13].indexOf(code) > -1){
      if (code === 40) val = val > limit.min ? val - 1 : val;
      if (code === 38) val = val < limit.max ? val + 1 : val;
      if (code === 13) val = val < limit.min ? limit.min : val > limit.max ? limit.max : val;
      input.val((isNaN(val) ? limit.min : val) +'px');
      e.preventDefault();
      input.trigger('change');
    }

}

/////////////////////////////////////////////////////////////////////////////

function onMetricsTextChange(e) {
  var mCtx = metricsContext;
  var code = (e.keyCode || e.which);
  // console.log('metrics key: %s', code);

  // do nothing if pressed key is an arrow key
  // [left, up, right, down, shift, ctrl, alt]
  if( [37, 38, 39, 40, 16, 17, 18].indexOf(code) > -1 ) {
      return;
  }

  mCtx.curr_mtext = this.value;
  mCtx.curr_mtext_width = mCtx.curr_mtext ? 
      Math.round(mCtx.contextT.measureText(mCtx.curr_mtext).width) : 0;
  
  drawText();

  // TODO trigger wheel events, in order to auto-scroll when text is deleted 
  // $(canvasT).trigger( jQuery.Event('DOMMouseScroll') );
  // $(canvasT).trigger( jQuery.Event('mousewheel') );
}

/////////////////////////////////////////////////////////////////////////////

function getFontList() {
  return [
  "Helvetica", "Georgia", "Baskerville", "Charter", "Avenir", "PT Serif", "PT Sans"
/*
    "Georgia","Abadi MT Condensed Light", "Academy Engraved LET", "ADOBE CASLON PRO", 
    "Adobe Garamond", "ADOBE GARAMOND PRO", "Agency FB", "Aharoni", 
    "Albertus Extra Bold", "Albertus Medium", "Algerian", "Amazone BT", 
    "American Typewriter", "American Typewriter Condensed", "AmerType Md BT", 
    "Andalus", "Angsana New", "AngsanaUPC", "Antique Olive", "Aparajita", 
    "Apple Chancery", "Apple Color Emoji", "Apple SD Gothic Neo", 
    "Arabic Typesetting", "ARCHER", "ARNO PRO", "Arrus BT", "Aurora Cn BT", 
    "AvantGarde Bk BT", "AvantGarde Md BT", "AVENIR", "Ayuthaya", "Bandy", 
    "Bangla Sangam MN", "Bank Gothic", "BankGothic Md BT", "Baskerville", 
    "Baskerville Old Face", "Batang", "BatangChe", "Bauer Bodoni", "Bauhaus 93",
    "Bazooka", "Bell MT", "Bembo", "Benguiat Bk BT", "Berlin Sans FB",
    "Berlin Sans FB Demi", "Bernard MT Condensed", "BernhardFashion BT", 
    "BernhardMod BT", "Big Caslon", "BinnerD", "Blackadder ITC", 
    "BlairMdITC TT", "Bodoni 72", "Bodoni 72 Oldstyle", "Bodoni 72 Smallcaps",
    "Bodoni MT", "Bodoni MT Black", "Bodoni MT Condensed", 
    "Bodoni MT Poster Compressed", "Bookshelf Symbol 7", "Boulder", 
    "Bradley Hand", "Bradley Hand ITC", "Bremen Bd BT", "Britannic Bold", 
    "Broadway", "Browallia New", "BrowalliaUPC", "Brush Script MT", 
    "Californian FB", "Calisto MT", "Calligrapher", "Candara", 
    "CaslonOpnface BT", "Castellar", "Centaur", "Cezanne", "CG Omega", 
    "CG Times", "Chalkboard", "Chalkboard SE", "Chalkduster", "Charlesworth", 
    "Charter Bd BT", "Charter BT", "Chaucer", "ChelthmITC Bk BT", "Chiller", 
    "Clarendon", "Clarendon Condensed", "CloisterBlack BT", "Cochin", 
    "Colonna MT", "Constantia", "Cooper Black", "Copperplate", 
    "Copperplate Gothic", "Copperplate Gothic Bold", "Copperplate Gothic Light",
    "CopperplGoth Bd BT", "Corbel", "Cordia New", "CordiaUPC", 
    "Cornerstone", "Coronet", "Cuckoo", "Curlz MT", "DaunPenh", "Dauphin", 
    "David", "DB LCD Temp", "DELICIOUS", "Denmark", "DFKai-SB", "Didot", 
    "DilleniaUPC", "DIN", "DokChampa", "Dotum", "DotumChe", "Ebrima", 
    "Edwardian Script ITC", "Elephant", "English 111 Vivace BT", "Engravers MT",
    "EngraversGothic BT", "Eras Bold ITC", "Eras Demi ITC", "Eras Light ITC", 
    "Eras Medium ITC", "EucrosiaUPC", "Euphemia", "Euphemia UCAS",
    "EUROSTILE", "Exotc350 Bd BT", "FangSong", "Felix Titling", "Fixedsys", 
    "FONTIN", "Footlight MT Light", "Forte", "FrankRuehl", "Fransiscan", 
    "Freefrm721 Blk BT", "FreesiaUPC", "Freestyle Script", "French Script MT",
    "FrnkGothITC Bk BT", "Fruitger", "FRUTIGER", "Futura", "Futura Bk BT", 
    "Futura Lt BT", "Futura Md BT", "Futura ZBlk BT", "FuturaBlack BT", 
    "Gabriola", "Galliard BT", "Gautami", "Geeza Pro", "Geometr231 BT", 
    "Geometr231 Hv BT", "Geometr231 Lt BT", "GeoSlab 703 Lt BT", 
    "GeoSlab 703 XBd BT", "Gigi", "Gill Sans", "Gill Sans MT", 
    "Gill Sans MT Condensed", "Gill Sans MT Ext Condensed Bold", 
    "Gill Sans Ultra Bold", "Gill Sans Ultra Bold Condensed", "Gisha", 
    "Gloucester MT Extra Condensed", "GOTHAM", "GOTHAM BOLD", 
    "Goudy Old Style", "Goudy Stout", "GoudyHandtooled BT", "GoudyOLSt BT", 
    "Gujarati Sangam MN", "Gulim", "GulimChe", "Gungsuh", "GungsuhChe", 
    "Gurmukhi MN", "Haettenschweiler", "Harlow Solid Italic", "Harrington", 
    "Heather", "Heiti SC", "Heiti TC", "HELV", "Helvetica", "Herald", "High Tower Text", 
    "Hiragino Kaku Gothic ProN", "Hiragino Mincho ProN", "Hoefler Text", 
    "Humanst 521 Cn BT", "Humanst521 BT", "Humanst521 Lt BT", 
    "Imprint MT Shadow", "Incised901 Bd BT", "Incised901 BT", 
    "Incised901 Lt BT", "INCONSOLATA", "Informal Roman", "Informal011 BT", 
    "INTERSTATE", "IrisUPC", "Iskoola Pota", "JasmineUPC", "Jazz LET", 
    "Jenson", "Jester", "Jokerman", "Juice ITC", "Kabel Bk BT", 
    "Kabel Ult BT", "Kailasa", "KaiTi", "Kalinga", "Kannada Sangam MN", 
    "Kartika", "Kaufmann Bd BT", "Kaufmann BT", "Khmer UI", "KodchiangUPC", 
    "Kokila", "Korinna BT", "Kristen ITC", "Krungthep", "Kunstler Script", 
    "Lao UI", "Latha", "Leelawadee", "Letter Gothic", "Levenim MT", "LilyUPC",
    "Lithograph", "Lithograph Light", "Long Island", "Lydian BT", "Magneto", 
    "Maiandra GD", "Malayalam Sangam MN", "Malgun Gothic", "Mangal", "Marigold", 
    "Marion", "Marker Felt", "Market", "Marlett", "Matisse ITC",
    "Matura MT Script Capitals", "Meiryo", "Meiryo UI", "Microsoft Himalaya", 
    "Microsoft JhengHei", "Microsoft New Tai Lue", "Microsoft PhagsPa", 
    "Microsoft Tai Le", "Microsoft Uighur", "Microsoft YaHei", 
    "Microsoft Yi Baiti", "MingLiU", "MingLiU_HKSCS", "MingLiU_HKSCS-ExtB", 
    "MingLiU-ExtB", "Minion", "Minion Pro", "Miriam", "Miriam Fixed", "Mistral", 
    "Modern", "Modern No. 20", "Mona Lisa Solid ITC TT", "Mongolian Baiti",
    "MONO", "MoolBoran", "Mrs Eaves", "MS LineDraw", "MS Mincho", "MS PMincho", 
    "MS Reference Specialty", "MS UI Gothic", "MT Extra", "MUSEO", "MV Boli", 
    "Nadeem", "Narkisim", "NEVIS", "News Gothic", "News GothicMT",
    "NewsGoth BT", "Niagara Engraved", "Niagara Solid", "Noteworthy", "NSimSun", 
    "Nyala", "OCR A Extended", "Old Century", "Old English Text MT", "Onyx",
    "Onyx BT", "OPTIMA", "Oriya Sangam MN", "OSAKA", "OzHandicraft BT", 
    "Palace Script MT", "Papyrus", "Parchment", "Party LET", "Pegasus", 
    "Perpetua", "Perpetua Titling MT", "PetitaBold", "Pickwick", 
    "Plantagenet Cherokee", "Playbill", "PMingLiU", "PMingLiU-ExtB", 
    "Poor Richard", "Poster", "PosterBodoni BT", "PRINCETOWN LET", "Pristina",
    "PTBarnum BT", "Pythagoras", "Raavi", "Rage Italic", "Ravie", 
    "Ribbon131 Bd BT", "Rockwell", "Rockwell Condensed", "Rockwell Extra Bold",
    "Rod", "Roman", "Sakkal Majalla", "Santa Fe LET", "Savoye LET",
    "Sceptre", "Script", "Script MT Bold", "SCRIPTINA", "Serifa", "Serifa BT", 
    "Serifa Th BT", "ShelleyVolante BT", "Sherwood", "Shonar Bangla", 
    "Showcard Gothic", "Shruti", "Signboard", "SILKSCREEN", "SimHei", 
    "Simplified Arabic", "Simplified Arabic Fixed", "SimSun", "SimSun-ExtB", 
    "Sinhala Sangam MN", "Sketch Rockwell", "Skia", "Small Fonts", "Snap ITC",
    "Snell Roundhand", "Socket", "Souvenir Lt BT", "Staccato222 BT", "Steamer",
    "Stencil", "Storybook", "Styllo", "Subway", "Swis721 BlkEx BT",
    "Swiss911 XCm BT", "Sylfaen", "Synchro LET", "System", "Tamil Sangam MN", 
    "Technical", "Teletype", "Telugu Sangam MN", "Tempus Sans ITC", "Terminal",
    "Thonburi", 'Times New Roman', "Traditional Arabic", "Trajan", "TRAJAN PRO",
    "Tristan", "Tubular", "Tunga", "Tw Cen MT", "Tw Cen MT Condensed",
    "Tw Cen MT Condensed Extra Bold", "TypoUpright BT", "Unicorn", "Univers", 
    "Univers CE 55 Medium", "Univers Condensed", "Utsaah", "Vagabond", "Vani",
    "Verdana", "Vijaya", "Viner Hand ITC", "VisualUI", "Vivaldi", "Vladimir Script",
    "Vrinda", "Westminster", "WHITNEY", "Wide Latin", "ZapfEllipt BT", 
    "ZapfHumnst BT", "ZapfHumnst Dm BT", "Zapfino", "Zurich BlkEx BT",
    "Zurich Ex BT", "ZWAdobeF"
    /**/
  ];
}