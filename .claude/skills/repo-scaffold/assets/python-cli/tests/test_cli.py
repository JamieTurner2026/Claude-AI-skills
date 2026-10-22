from {{pkg}}.cli import main


def test_main_greets(capsys):
    assert main(["tester"]) == 0
    assert "Hello, tester!" in capsys.readouterr().out
