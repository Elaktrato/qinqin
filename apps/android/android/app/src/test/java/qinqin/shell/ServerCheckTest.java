package qinqin.shell;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ServerCheckTest {
    @Test
    public void qinqinsAnswerIsRecognised() {
        assertEquals(ServerCheck.Result.QINQIN, ServerCheck.classify(200, "{\"app\":\"qinqin\",\"version\":\"0.7.0\"}"));
        assertEquals(ServerCheck.Result.QINQIN, ServerCheck.classify(200, "{ \"app\" : \"qinqin\" }"));
    }

    @Test
    public void anythingElseThatAnswersIsNotQinqin() {
        assertEquals(ServerCheck.Result.NOT_QINQIN, ServerCheck.classify(200, "<html>parked</html>"));
        assertEquals(ServerCheck.Result.NOT_QINQIN, ServerCheck.classify(200, "{\"app\":\"other\"}"));
        assertEquals(ServerCheck.Result.NOT_QINQIN, ServerCheck.classify(200, null));
        assertEquals(ServerCheck.Result.NOT_QINQIN, ServerCheck.classify(404, "{\"app\":\"qinqin\"}"));
        assertEquals(ServerCheck.Result.NOT_QINQIN, ServerCheck.classify(502, ""));
        assertEquals(ServerCheck.Result.NOT_QINQIN, ServerCheck.classify(302, null));
    }
}
