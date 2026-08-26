// 对话文件：Kid 与海明的第一次对话
// 作者：Lequ
// 描述：Kid刚爬起来在荒郊与海明的初见对话
// 最后修改时间: 2026/04/30 21:24:28

if (global.eventItem[gev_haming_annoyed_to_talking])
    return self;

if (object_index != objGame)
    return noone;

// --- 自定义变量 ---
scrDefault("eventDialogNothing", 0);

var _graph, _node, _list, _start;
_start = -1;
_graph = ds_graph_create();

// --- 节点定义 ---

_node[3] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "你好啊！需要什么帮助吗？";
    _text[lang_en] = "Hey there! Need any help?";
    displayingText = _text[global.language];

    character_id[npc_haming] = scrCharacterAddPlace(npc_haming, fa_right, 1, -1);
    character_id[npc_kid] = scrCharacterAddPlace(npc_kid, fa_left, 0, 1);
    scrCharacterStartEffect(character_id[npc_haming], nm_enter_from_right);
    scrCharacterStartEffect(character_id[npc_kid], nm_enter_from_left);
    
    scrCharacterSetExpression(character_id[npc_haming], exp_open_mouth);
    //*/
');

_node[5] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "不好意思，请问这周边有没有可以歇脚的地方？#我莫名奇妙地从一个不认识的地方醒来，周边都是陌生的环境。";
    _text[lang_en] = "Excuse me, is there anywhere nearby I can rest?#I woke up out of nowhere in an unfamiliar place, with nothing but strange surroundings all around me.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_question);
    //*/
');

_node[6] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "醒来？你是从那个逃生舱下来的吗？#我看到有东西从天上掉下来，还以为是那些高高在上的老爷们在给我们扔救援物资来了，于是过来看看。";
    _text[lang_en] = "Woke up? Did you come out of that escape pod?#I saw something fall from the sky, thought the big shots up in the sky were tossing us some aid supplies, so I came over to check it out.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_question);
    scrCharacterSetExpression(character_id[npc_haming], exp_ponder);
    //*/
');

_node[7] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "目前所有的证据都只能说明我是从那里出来的了。#我实在想不通为什么会有人会打晕我，然后把我抛到这个看上去荒无人烟的鬼地方来......#好像还真有可能？";
    _text[lang_en] = "All the evidence I have right now points to me coming out of that thing.#I can`t fathom why someone would knock me out and dump me in this godforsaken, desolate place...#Wait, that actually sounds plausible?";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_kid], exp_ponder);
    //*/
');

_node[8] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "就是说，你是在你不知情的情况下来这里的？#你以前惹了什么不该惹的人？不会是摩洛集团那些老爷们吧。";
    _text[lang_en] = "So you`re saying you ended up here without knowing a thing?#Did you cross someone you shouldn`t have in the past? Don`t tell me it was those big shots from the Molo Group.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_normal);
    //*/
');

_node[9] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "等等......我好像有点与你说的话脱节了，什么援助用品，什么摩洛集团的老爷们，我不记得与他们有过瓜葛啊。";
    _text[lang_en] = "Wait… I think I`m a little lost here. Aid supplies? Big shots from the Molo Group?#I don`t remember having anything to do with any of that.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_wait);
    scrCharacterSetExpression(character_id[npc_kid], exp_open_mouth);
    //*/
');

_node[10] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "不对，以前发生的事情我都记不得了，这应该是典型的失忆症状了。#我到底是从哪里来的......不行，完全想不起来。";
    _text[lang_en] = "No, wait — I can`t remember anything that happened before. This has to be classic amnesia.#Where on earth did I come from... Nothing. I can`t recall a single thing.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_exclamation);
    //*/
');

_node[11] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "嗯，对，你从火星来的。";
    _text[lang_en] = "Yeah, exactly. You`re from Mars.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_ponder);
    //*/
');

_node[12] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "欢迎来到濒临毁灭的世界，地球。";
    _text[lang_en] = "Welcome to Earth, the world on the brink of collapse.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_salute);
    scrCharacterSetExpression(character_id[npc_haming], exp_normal);
    //*/
');

_node[13] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "？";
    _text[lang_en] = "?";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_question);
    //*/
');

_node[14] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "哈哈，其实是我猜的。毕竟这种东西只能从火星上来的了。#你应该是在火星上生活，然后来到了这里。";
    _text[lang_en] = "Hahaha, just my guess, honestly. A thing like that could only come from Mars.#You must`ve been living up there, then ended up down here.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_happy);
    //*/
');

_node[15] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "不对吧，地球的重力是火星的2.6倍重。#如果按你所说在火星上生活，并习惯了火星的环境，我在这里应该会觉得身体很重。#但我现在身体没有任何不适啊。";
    _text[lang_en] = "That doesn`t add up. Earth`s gravity is 2.6 times stronger than Mars`.#If I`d lived on Mars and acclimated to that environment like you said, my body would feel overwhelmingly heavy here. But I don`t feel the slightest bit of discomfort.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_action);
    //*/
');

_node[16] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "感觉你很博学啊，你真的失忆了吗？";
    _text[lang_en] = "You sound really knowledgeable. Are you sure you have amnesia?";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_chat);
    scrCharacterSetExpression(character_id[npc_haming], exp_confidence);
    //*/
');

_node[17] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "看看你左手臂。如果我猜的没错，你应该带着个手环。";
    _text[lang_en] = "Check your left arm. If I`m right, you`ve got a wristband on it.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_action);
    scrCharacterSetExpression(character_id[npc_haming], exp_open_mouth);
    //*/
');

_node[18] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "（检查了左手臂）还真是，这个手环是干什么的？完全看不出来它的作用。";
    _text[lang_en] = "(checks his left arm) Huh, you`re right. What is this wristband even for?#I can`t make out its purpose at all.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_kid], exp_open_mouth);
    //*/
');

_node[19] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "这是从火星流放到地球的人带的手环，它有挺多功能的，让人适应地球的重力环境也是这个手环的功能之一。#这样的人我们称为流放者。";
    _text[lang_en] = "This is the wristband given to people exiled from Mars to Earth. It has a bunch of functions, one of which is letting the wearer adapt to Earth`s gravity.#We call people like you Exiles.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_confidence);
    //*/
');

_node[20] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "流放者对我们来说特别少见。大概几年甚至几十年才会有一个。";
    _text[lang_en] = "Exiles are extremely rare for us. We might get one every few years, even decades.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_open_mouth);
    //*/
');

_node[21] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "哎呀不扯这些了。#你不是想去歇脚的地方吗，去我们的村子里，大概一直往右边走就到了，目前路线还挺单一的。";
    _text[lang_en] = "Alright, enough of that. You were looking for a place to rest, right?#Head straight right to our village, the path`s pretty straightforward for now.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_chat);
    scrCharacterSetExpression(character_id[npc_haming], exp_happy);
    //*/
');

_node[22] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "看你长途跋涉来到地球，去我们村子里的医务室检查一下吧。#确定一下你失忆可能的原因，顺带检查一下身体有没有什么其他异常情况。";
    _text[lang_en] = "After that long trip to Earth, you should head to the village clinic to get checked out.#We can figure out what might be causing your amnesia, and make sure there`s nothing else wrong with you.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_open_mouth);
    //*/
');

_node[23] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "好的，谢谢您对我做的一切，再见。";
    _text[lang_en] = "Alright. Thank you so much for everything, goodbye.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_salute);
    //*/
');

_node[24] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "哈哈哈，在火星上表达感谢这么别扭的吗。";
    _text[lang_en] = "Hahaha, is saying thank you this awkward on Mars?";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_chat);
    scrCharacterSetExpression(character_id[npc_haming], exp_happy);
    //*/
');

_node[25] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "我叫海明，感觉你是个很有趣的人，我相信我们之后还会再见的。#我们就以朋友的身份相处吧，不用那么拘谨的。";
    _text[lang_en] = "I`m Haming. You seem like a really interesting person, We`ll be seeing each other again soon.#Let`s be friends, no need to be so formal around me.";
    displayingText = _text[global.language];

    global.eventItem[gev_know_haming_name] = true;
    
    scrCharacterStartEffect(character_id[npc_haming], nm_action);
    scrCharacterSetExpression(character_id[npc_haming], exp_open_mouth);
    //*/
');

_node[26] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "我叫......";
    _text[lang_en] = "My name is...";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_kid], exp_open_mouth);
    //*/
');

_node[27] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "............";
    _text[lang_en] = "......";
    displayingText = _text[global.language];
');

_node[28] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "..................";
    _text[lang_en] = "............";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_wait);
    //*/
');

_node[29] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "惨了，我连我的名字都不记得了。#我真得去你们村子的医务室检查一下了，希望你们的医生不是半吊子的江湖郎中。";
    _text[lang_en] = "Oh no. I can`t even remember my own name.#I really need to get to that clinic. Hope your doctor isn`t some half-baked quack.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_talkless);
    scrCharacterSetExpression(character_id[npc_kid], exp_normal);
    //*/
');

_node[30] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "包的呀，他之前就医过类似的人了，你放一百个心。";
    _text[lang_en] = "Don`t worry, he`s treated people like you before. You can rest easy.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_confidence);
    //*/
');

_node[32] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "（我本来只是想问问路的，没想到能获得那么多信息。）";
    _text[lang_en] = "(I just wanted to ask for directions. I never expected to learn this much.)";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_exit_to_right);
    scrCharacterStartEffect(character_id[npc_kid], nm_move_right);
    //*/
');

_node[33] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "（援助用品、摩洛集团、火星和地球、流放者......这么多名词，我对此还有很多疑点。）";
    _text[lang_en] = "(Aid supplies, the Molo Group, Mars and Earth, Exiles… So many terms, and I still have so many questions about all of it.)";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_wait);
    //*/
');

_node[34] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "（最在意的还是海明最后说的“类似的人”，这是什么意思？#是失忆的人，还是跟我一样从火星来到这里的人，又或是两者都有？）";
    _text[lang_en] = "(What bothers me most is what Haming said at the end—``people like you``. What does that mean?#People with amnesia? People who came from Mars like me? Or both?)";
    displayingText = _text[global.language];
');

_node[35] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "（再去问问他详细的信息？还是尽快赶路？我得好好想想。）";
    _text[lang_en] = "(Should I go back and ask him for more details? Or hurry to the village? I need to think this through carefully.)";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_question);
    //*/
');

_node[36] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "哦，对了，给你几个苹果吧，可以将你从感觉不好的状态拉回来。";
    _text[lang_en] = "Oh, right! Take these apples. They`ll help you feel better if you`re under the weather.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_enter_from_right);
    scrCharacterSetExpression(character_id[npc_haming], exp_happy);
    
    scrCharacterStartEffect(character_id[npc_kid], nm_move_left);
    //*/
');

_node[37] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "路上那些零零散散的箱子里面可能也有物资，路过时可以停下来看一看。";
    _text[lang_en] = "There might be supplies in those scattered crates along the road. Feel free to stop and check them out if you pass by.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_open_mouth);
    //*/
');

_node[38] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "好的。";
    _text[lang_en] = "Alright.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_salute);
    //*/
');

_node[40] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "还有什么事吗？朋友。";
    _text[lang_en] = "Something else, friend?";
    displayingText = _text[global.language];

    character_id[npc_haming] = scrCharacterAddPlace(npc_haming, fa_right, 1, -1);
    character_id[npc_kid] = scrCharacterAddPlace(npc_kid, fa_left, 0, 1);
    scrCharacterStartEffect(character_id[npc_haming], nm_enter_from_right);
    scrCharacterStartEffect(character_id[npc_kid], nm_enter_from_left);
    
    scrCharacterSetExpression(character_id[npc_haming], exp_open_mouth);
    
    switch eventDialogNothing
    {
        case 1:
            _text[lang_en] = "Something else?";
            _text[lang_cn] = "还有什么事吗？";
            break;
    
        case 2:
            _text[lang_en] = "Something else?!";
            _text[lang_cn] = "还有什么事吗？！";
            break;
            
        case 3:
            _text[lang_en] = "Something else!!";
            _text[lang_cn] = "还有什么事吗！！";
            break;
            
        case 4:
            _text[lang_en] = "SOMETHING ELSE!!!";
            _text[lang_cn] = "还有什么事吗！！！";
            break;
    }
    
    displayingText = _text[global.language];
    //*/
');

_node[42] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "不好意思，请再说一遍要去哪里？";
    _text[lang_en] = "Sorry, could you repeat where I`m supposed to go?";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_shy);
    //*/
');

_node[43] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "详细讲讲......";
    _text[lang_en] = "Can you tell me more about…";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_kid], nm_action);
    //*/
');

_node[44] = ds_graph_node_add(_graph, '
    curCharacter = npc_kid;

    var _text; 
    _text[lang_cn] = "没什么事。";
    _text[lang_en] = "Nothing, never mind.";
    displayingText = _text[global.language];
');

_node[45] = ds_graph_node_add(_graph, '
    var _text; 
    _text[lang_cn] = "要去哪里？";
    _text[lang_en] = "Where am I going?";
    return _text[global.language];
');

_node[46] = ds_graph_node_add(_graph, '
    var _text; 
    _text[lang_cn] = "想知道一些事情";
    _text[lang_en] = "I want to know a few things";
    return _text[global.language];
');

_node[47] = ds_graph_node_add(_graph, '
    var _text; 
    _text[lang_cn] = "没什么事";
    _text[lang_en] = "Nothing";
    return _text[global.language];
');

_node[48] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "去我们村子里的医务室检查一下。真是的，这么快就忘了，你得的是失忆，又不是健忘。";
    _text[lang_en] = "To the village clinic to get checked out. Geez, you forgot already? You have amnesia, not a bad memory.";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_sweat);
    //*/
');

_node[49] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "这里不是慢慢说话的地方。这样吧，你检查完毕之后，我们好好唠一唠相关的东西。";
    _text[lang_en] = "This isn`t the place for a long chat. Tell you what, once you`re done with your checkup, we can sit down and talk about everything properly.";
    displayingText = _text[global.language];

    scrCharacterSetExpression(character_id[npc_haming], exp_normal);
    //*/
');

_node[52] = ds_graph_node_add(_graph, '
    curCharacter = npc_haming;

    var _text; 
    _text[lang_cn] = "没什么事就不要跟我搭话了啦！很烦的你知不知道！";
    _text[lang_en] = "Quit talking to me if you`ve got nothing to say! Ugh, you`re so annoying, you know that?!";
    displayingText = _text[global.language];

    scrCharacterStartEffect(character_id[npc_haming], nm_angry);
    //*/
');


// --- 逻辑分支与连线定义 ---

if (global.eventItem[gev_end_first_talking]) {
    _start = _node[40];
} else {
    _start = _node[3];
}
ds_graph_edge_add(_graph, _node[3], _node[5], 0, true);
ds_graph_edge_add(_graph, _node[5], _node[6], 0, true);
ds_graph_edge_add(_graph, _node[6], _node[7], 0, true);
ds_graph_edge_add(_graph, _node[7], _node[8], 0, true);
ds_graph_edge_add(_graph, _node[8], _node[9], 0, true);
ds_graph_edge_add(_graph, _node[9], _node[10], 0, true);
ds_graph_edge_add(_graph, _node[10], _node[11], 0, true);
ds_graph_edge_add(_graph, _node[11], _node[12], 0, true);
ds_graph_edge_add(_graph, _node[12], _node[13], 0, true);
ds_graph_edge_add(_graph, _node[13], _node[14], 0, true);
ds_graph_edge_add(_graph, _node[14], _node[15], 0, true);
ds_graph_edge_add(_graph, _node[15], _node[16], 0, true);
ds_graph_edge_add(_graph, _node[16], _node[17], 0, true);
ds_graph_edge_add(_graph, _node[17], _node[18], 0, true);
ds_graph_edge_add(_graph, _node[18], _node[19], 0, true);
ds_graph_edge_add(_graph, _node[19], _node[20], 0, true);
ds_graph_edge_add(_graph, _node[20], _node[21], 0, true);
ds_graph_edge_add(_graph, _node[21], _node[22], 0, true);
ds_graph_edge_add(_graph, _node[22], _node[23], 0, true);
ds_graph_edge_add(_graph, _node[23], _node[24], 0, true);
ds_graph_edge_add(_graph, _node[24], _node[25], 0, true);
ds_graph_edge_add(_graph, _node[25], _node[26], 0, true);
ds_graph_edge_add(_graph, _node[26], _node[27], 0, true);
ds_graph_edge_add(_graph, _node[27], _node[28], 0, true);
ds_graph_edge_add(_graph, _node[28], _node[29], 0, true);
ds_graph_edge_add(_graph, _node[29], _node[30], 0, true);
ds_graph_edge_add(_graph, _node[30], _node[32], 0, true);
ds_graph_edge_add(_graph, _node[32], _node[33], 0, true);
ds_graph_edge_add(_graph, _node[33], _node[34], 0, true);
ds_graph_edge_add(_graph, _node[34], _node[35], 0, true);
ds_graph_edge_add(_graph, _node[35], _node[36], 0, true);
ds_graph_edge_add(_graph, _node[36], _node[37], 0, true);
ds_graph_edge_add(_graph, _node[37], _node[38], 0, true);
ds_graph_edge_add(_graph, _node[40], _node[45], 0, true);
ds_graph_edge_add(_graph, _node[40], _node[46], 1, true);
ds_graph_edge_add(_graph, _node[40], _node[47], 2, true);
ds_graph_edge_add(_graph, _node[42], _node[48], 0, true);
ds_graph_edge_add(_graph, _node[43], _node[49], 0, true);
if (eventDialogNothing >= 4) {
    ds_graph_edge_add(_graph, _node[44], _node[52], 0, true);
} else {
}
ds_graph_edge_add(_graph, _node[45], _node[42], 0, true);
ds_graph_edge_add(_graph, _node[46], _node[43], 0, true);
ds_graph_edge_add(_graph, _node[47], _node[44], 0, true);


// --- 对话结束逻辑 ---

dialog_end(_node[38], '
    scrCharacterStartEffect(character_id[npc_kid], nm_exit_to_left);
    scrCharacterStartEffect(character_id[npc_haming], nm_exit_to_right);
    
    global.eventItem[gev_end_first_talking] = true;
    global.ShowRedPointInstructor = true;
    
    scrAddBagInstruction("add qr_materials_apple 5");
    
    execute_in_deact_object(objPlayer, "scrPlayerSetFrozen(player_state_move_frozen)");
    call_later(30, "
        scrGetTutorial(tuto_backpackUI1);
        scrGetTutorial(tuto_backpackUI2);
        scrPlayerSetFrozen(player_state_normal);
    ");
    //*/
');

dialog_end(_node[49], '
    scrCharacterStartEffect(character_id[npc_haming], nm_exit_to_right);
    scrCharacterStartEffect(character_id[npc_kid], nm_exit_to_left);
    //*/
');

dialog_end(_node[48], '
    scrCharacterStartEffect(character_id[npc_haming], nm_exit_to_right);
    scrCharacterStartEffect(character_id[npc_kid], nm_exit_to_left);
    //*/
');

dialog_end(_node[52], '
    scrCharacterStartEffect(character_id[npc_haming], nm_exit_to_right);
    scrCharacterStartEffect(character_id[npc_kid], nm_exit_to_left);
    
    if eventDialogNothing >= 4
    {
        eventDialogNothing = 0;
        global.eventItem[gev_haming_annoyed_to_talking] = true;
    }
    else
        eventDialogNothing += 1;
    //*/
');

dialog_end(_node[44], '
    scrCharacterStartEffect(character_id[npc_haming], nm_exit_to_right);
    scrCharacterStartEffect(character_id[npc_kid], nm_exit_to_left);
    
    if eventDialogNothing >= 4
    {
        eventDialogNothing = 0;
        global.eventItem[gev_haming_annoyed_to_talking] = true;
    }
    else
        eventDialogNothing += 1;
    //*/
');

_list = ds_list_create();
ds_list_add(_list, _graph);
ds_list_add(_list, _start);
return _list;

/* EDITOR_DATA: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 */