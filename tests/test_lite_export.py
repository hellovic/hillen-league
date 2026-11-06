import json
from pathlib import Path
import tempfile
import unittest
import server
class LiteExportTests(unittest.TestCase):
    def test_full_payload_reconstructed_and_legacy_bootstrap_preserved(self):
        rows=[{'player_id':7,'player_name':'Player','team_id':8,'team_name':'Team','pts':28,'ast':4}]
        bundle={'meta':{'counts':{}},'season/33':{},'33/16/players':rows,'33/16/teams':[],
                '33/16/players/7':{'pts':28},'33/16/teams/8':{'roster':[]}}
        with tempfile.TemporaryDirectory() as folder:
            server.write_split_data(folder,bundle)
            read=lambda name:json.loads(Path(folder,name).read_text().split('window.LEAGUE_DATA = ')[1].rstrip(';\n'))
            lite=read('league-bootstrap-lite.js');legacy=read('league-bootstrap.js')
            self.assertEqual(rows,legacy['33/16/players'])
            self.assertNotIn('33/16/players',lite)
            self.assertEqual([{'player_id':7,'player_name':'Player','team_id':8,'team_name':'Team'}],lite['__players_index']['33/16'])
            reconstructed={k:v for k,v in lite.items() if not k.startswith('__')}
            for url in set(lite['__detail_files'].values())|set(lite['__list_files'].values()):
                reconstructed.update(json.loads(Path(folder,url.split('?')[0]).read_text()))
            self.assertEqual(bundle,reconstructed)
            detail=json.loads(Path(folder,next(iter(lite['__detail_files'].values())).split('?')[0]).read_text())
            self.assertEqual(rows,detail['33/16/players'])
    def test_empty_player_list_needs_no_additional_fetch(self):
        with tempfile.TemporaryDirectory() as folder:
            server.write_split_data(folder,{'meta':{},'33/29/players':[]})
            lite=json.loads(Path(folder,'league-bootstrap-lite.js').read_text().split('window.LEAGUE_DATA = ')[1].rstrip(';\n'))
            self.assertEqual([],lite['33/29/players']);self.assertNotIn('33/29/players',lite['__list_files'])
