<?php
    $inputs = json_decode(file_get_contents("php://input"), true);
    $username = $inputs['username'];
    $game_number = $inputs['game_number'];

    $domain = 'https://www.ficsgames.org';
    $history_path1 = '/cgi-bin/search.cgi?player=';
    $history_path2 = '&action=History';

    $html = @file_get_contents($domain.$history_path1.$username.$history_path2);
    if($html === FALSE) {
        echo "FAILED";
        return;
    }
    
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);

    $dom->loadHTML($html);
    $xpath = new DOMXPath($dom);

    // find the element whose href value you want by XPath
    $nodes = $xpath->query('//*[@class="result-table"]/tr['.(3 + $game_number).']/td[11]/a');

    if($nodes->length > 0) {
        $game_path = $nodes->item(0)->getAttribute( 'href' ); 
        echo $domain.$game_path;
    }
?>